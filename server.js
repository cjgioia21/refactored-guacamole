// TrueHumanNature — attraction-based matchmaking server with accounts.
import "./src/env.js"; // must be first: later imports read secrets at load time
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import * as store from "./src/store.js";
import * as auth from "./src/auth.js";
import { QUESTIONS, AXES } from "./src/questions.js";
import { MORAL_QUESTIONS, VICES, MORAL_MIN_ANSWERED } from "./src/morality.js";
import * as confessions from "./src/confessions.js";
import * as photos from "./src/photos.js";
import * as phototokens from "./src/phototokens.js";
import * as legal from "./src/legal.js";
import * as geo from "./src/geo.js";
import * as identity from "./src/identity.js";
import * as reports from "./src/reports.js";
import {
  recordVote, report, guessOutcome, likes,
  GAMES, gameByKey, attractivenessBand, guessConsensus, fansReport, tasteReport, TASTES,
  axisValue, VERSUS_AXES, moralityVsLooks,
  topTen, boardGenders, standingOf, boardEligible, isParticipant, BOARD_MIN_MATCHUPS, winRate, rankOf,
} from "./src/engine.js";

// Admin accounts, by email — set ADMIN_EMAILS="you@example.com,other@example.com".
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
);
const isAdmin = (account) => !!account && ADMIN_EMAILS.has(String(account.email || "").toLowerCase());

// Credit economy
const COST = { reveal: 30, pairs: 75, fans: 300 };
const PAIRS_AMOUNT = 200;
// Purchasable credit packs (mirrors the site's one-time packs).
const CREDIT_PACKS = [
  { id: "starter", price: 15, credits: 100, ratingsEq: "1–4 ratings" },
  { id: "popular", price: 40, credits: 300, ratingsEq: "4–12 ratings", badge: "SAVE 11%", popular: true },
  { id: "big", price: 100, credits: 1000, ratingsEq: "13–40 ratings", badge: "SAVE 33%" },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Behind a reverse proxy / PaaS load balancer, trust X-Forwarded-* so secure
// cookies and https detection work.
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(geo.geoGate); // regional restrictions — see src/geo.js for the honest limits
app.get("/unavailable", (_req, res) => res.status(451).type("html").send(geo.unavailableHtml()));

app.use(express.json({ limit: "1mb" })); // room for small uploaded data: URLs

// ---------- Photos ----------
// No stable URL: every link is an HMAC over (photoId, viewerAccountId, expiry),
// good for ten minutes and useless in anyone else's session. See
// src/phototokens.js for why this is the control that matters most here.
app.get("/photos/:id", (req, res) => {
  const id = req.params.id;
  const account = auth.currentAccount(req);
  // Signed-in only. An unauthenticated request can't hold a valid token anyway,
  // but failing here keeps photos out of reach of anything crawling the site.
  if (!account) return res.status(401).end();
  if (!photos.isPhotoId(id)) return res.status(404).end();
  if (!phototokens.verify(req.query.t, id, account.id)) return res.status(403).end();
  if (!phototokens.spendBudget(account.id)) return res.status(429).end();

  const buf = photos.get(id);
  if (!buf) return res.status(404).end();
  res.set({
    "Content-Type": "image/jpeg",
    "Content-Length": String(buf.length),
    // Private to this viewer, never stored by a shared cache, never indexed.
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, noimageindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(buf);
});

app.use(express.static(join(__dirname, "public")));

const CREDIT_PER_VOTES = 50; // 1 credit per 50 ratings — credits are scarce
const GUESS_AXES = [...VERSUS_AXES, "age", "gender", "mh"];
const oauthStates = new Set();

// Where a finished score sits against everyone else who finished the quiz.
// Null until the user has taken enough of it for the number to mean anything.
function moralPercentile(me, population) {
  if ((me.moralAnswered || 0) < MORAL_MIN_ANSWERED) return null;
  const scores = population
    .filter((u) => u.id !== me.id && (u.moralAnswered || 0) >= MORAL_MIN_ANSWERED)
    .map((u) => u.natureScore || 0);
  if (scores.length < 3) return null;
  const worse = scores.filter((s) => s < (me.natureScore || 0)).length;
  return Math.round((worse / scores.length) * 100);
}

// Who is asking. Photo URLs are minted for this id and work for nobody else.
const viewerId = (req) => auth.currentAccount(req)?.id || null;

// Resolve the signed-in account's profile (or null).
function myProfile(req) {
  const account = auth.currentAccount(req);
  return account && account.profileId ? store.get(account.profileId) : null;
}
// The client's IP, honouring the proxy chain we already trust in production.
const clientIp = (req) => req.ip || req.socket?.remoteAddress || null;

// Require an onboarded profile; 401/409 otherwise. Sets req.profile.
function requireProfile(req, res, next) {
  const account = auth.currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });
  // An outstanding agreement blocks every write. The client turns this into
  // the "accept the new terms" screen.
  const owed = legal.outstanding(account);
  if (owed.length) return res.status(451).json({ error: "agreement required", outstanding: owed });
  const profile = account.profileId ? store.get(account.profileId) : null;
  if (!profile) return res.status(409).json({ error: "no profile yet" });
  req.account = account;
  req.profile = profile;
  next();
}
// Require an admin account (ADMIN_EMAILS). 401/403 otherwise.
function requireAdmin(req, res, next) {
  const account = auth.currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });
  if (!isAdmin(account)) return res.status(403).json({ error: "not an admin" });
  req.account = account;
  next();
}

// ---------- Auth ----------
app.post("/auth/signup", (req, res) => {
  const { email, password, state } = req.body || {};
  // Regional restrictions are checked at the door, not after the account exists.
  const country = req.geo?.country || (state ? "US" : null);
  const declared = { country, state: state ? String(state).toUpperCase() : req.geo?.state || null };
  const regionError = geo.checkSignupRegion(declared);
  if (regionError) return res.status(451).json({ error: regionError });

  const r = auth.signup(email, password);
  if (r.error) return res.status(400).json({ error: r.error });
  auth.setRegion(r.account.id, declared);
  // Creating an account is the act of accepting the terms — record it with the
  // version and IP, so there's evidence rather than an assumption.
  for (const key of legal.REQUIRED) auth.recordAgreement(r.account.id, key, legal.acceptanceRecord(key, clientIp(req)));
  auth.issueSession(res, r.account.id);
  res.status(201).json({ account: auth.publicAccount(r.account) });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const r = auth.login(email, password);
  if (r.error) return res.status(401).json({ error: r.error });
  auth.issueSession(res, r.account.id);
  res.json({ account: auth.publicAccount(r.account) });
});

app.post("/auth/logout", (req, res) => {
  auth.endSession(res);
  res.json({ ok: true });
});

app.get("/auth/config", (req, res) => res.json({
  google: auth.googleConfigured(),
  country: req.geo?.country || null,
  // The state selector only matters for US visitors, and it's the only control
  // standing between an Illinois resident and a BIPA claim. See src/geo.js.
  usStates: geo.US_STATES,
  blockedStates: [...geo.BLOCKED_STATES],
}));

app.get("/auth/google", (req, res) => {
  if (!auth.googleConfigured()) return res.status(503).send("Google sign-in is not configured on this server.");
  const state = randomBytes(12).toString("hex");
  oauthStates.add(state);
  res.redirect(auth.googleAuthUrl(state));
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    if (!oauthStates.delete(req.query.state)) return res.status(400).send("bad state");
    const identity = await auth.googleExchange(req.query.code);
    const account = auth.upsertGoogle(identity);
    auth.issueSession(res, account.id);
    res.redirect("/");
  } catch {
    res.status(500).send("Google sign-in failed.");
  }
});

// Current account + its profile.
app.get("/api/me", (req, res) => {
  const account = auth.currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });
  const profile = account.profileId ? store.get(account.profileId) : null;
  res.json({
    account: auth.publicAccount(account),
    isAdmin: isAdmin(account),
    outstanding: legal.outstanding(account),
    profile: profile ? store.ownerView(profile, account.id) : null,
  });
});

// ---------- Legal ----------
// The documents themselves are public: nobody should have to create an account
// to read what they'd be agreeing to.
app.get("/api/legal/:doc", (req, res) => {
  const key = req.params.doc;
  const html = legal.docHtml(key);
  if (!html) return res.status(404).json({ error: "unknown document" });
  res.json({ key, title: legal.DOCS[key].title, version: legal.DOCS[key].version, html });
});

// What this account still has to accept before the app will work.
app.get("/api/legal", (req, res) => {
  const account = auth.currentAccount(req);
  res.json({
    docs: Object.fromEntries(Object.entries(legal.DOCS).map(([k, d]) => [k, { title: d.title, version: d.version }])),
    outstanding: account ? legal.outstanding(account) : legal.REQUIRED,
    accepted: account?.agreements || {},
  });
});

app.post("/api/legal/accept", (req, res) => {
  const account = auth.currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });
  const keys = Array.isArray(req.body?.docs) ? req.body.docs : [req.body?.doc];
  const valid = keys.filter((k) => legal.DOCS[k]);
  if (!valid.length) return res.status(400).json({ error: "unknown document" });
  for (const key of valid) auth.recordAgreement(account.id, key, legal.acceptanceRecord(key, clientIp(req)));
  const fresh = auth.accountById(account.id);
  res.json({ ok: true, accepted: fresh.agreements, outstanding: legal.outstanding(fresh) });
});

// ---------- Questionnaire / meta ----------
app.get("/api/questions", (_req, res) => res.json({ questions: QUESTIONS, axes: AXES }));

// ---------- The morality quiz (feeds the Human Nature score) ----------
app.get("/api/moral-questions", (req, res) => {
  const me = myProfile(req);
  res.json({
    questions: MORAL_QUESTIONS,
    vices: VICES,
    answers: me?.moralAnswers || {},
    answered: me?.moralAnswered || 0,
    minAnswered: MORAL_MIN_ANSWERED,
  });
});

// Answer one question. Responds with what everyone else said — the whole point.
app.post("/api/moral-answer", requireProfile, (req, res) => {
  const qid = String(req.body?.qid || "");
  const i = Number(req.body?.i);
  const q = MORAL_QUESTIONS.find((x) => x.id === qid);
  if (!q || !q.options[i]) return res.status(400).json({ error: "unknown question" });
  const previous = req.profile.moralAnswers?.[qid];
  store.setAnswer(req.profile.id, qid, i, "moral");
  const stats = confessions.record(qid, i, previous === i ? null : previous);
  res.json({
    ok: true,
    stats,
    score: req.profile.natureScore,
    answered: req.profile.moralAnswered,
    total: MORAL_QUESTIONS.length,
  });
});
app.get("/api/meta", (_req, res) =>
  res.json({ axes: AXES, guessAxes: GUESS_AXES, games: GAMES, cost: COST, pairsAmount: PAIRS_AMOUNT,
    tastes: TASTES.map((t) => ({ key: t.key, title: t.title, unlockAt: t.unlockAt })),
    creditPerVotes: CREDIT_PER_VOTES,
    board: { minMatchups: BOARD_MIN_MATCHUPS },
    vices: VICES, moralTotal: MORAL_QUESTIONS.length,
    verification: { required: identity.REQUIRED, configured: identity.configured(), mode: identity.MODE },
    game: { rounds: GAME_ROUNDS, need: GAME_NEED, reward: GAME_REWARD } })
);

// ---------- Profile (owned by the session account) ----------
app.post("/api/profile", async (req, res) => {
  const account = auth.currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });

  // Image bytes never reach the profile store. They're sanitized (re-encoded,
  // EXIF/GPS destroyed) and encrypted first; what's stored is just an id.
  const body = { ...(req.body || {}) };
  if (body.photo) {
    try {
      body.photo = await photos.put(body.photo);
    } catch (err) {
      if (err instanceof photos.PhotoError) return res.status(400).json({ error: err.message });
      throw err;
    }
  } else {
    delete body.photo; // editing without re-uploading keeps the existing photo
  }
  // The ID document, if one was submitted, goes through the same sanitize +
  // encrypt path as a photo. It is never returned to any client and is shredded
  // the moment you make a moderation decision (see store.moderatePhoto).
  if (body.idDocument) {
    try {
      body.idDoc = await photos.put(body.idDocument);
    } catch (err) {
      if (err instanceof photos.PhotoError) return res.status(400).json({ error: `ID document: ${err.message}` });
      throw err;
    }
  }
  delete body.idDocument; // never store the raw field
  let profile;
  if (account.profileId && store.get(account.profileId)) {
    const existing = store.get(account.profileId);
    if (existing.accountLocked) return res.status(403).json({ error: "account locked by moderation" });
    profile = store.update(account.profileId, body);
  } else {
    profile = store.create({ ...body, accountId: account.id });
    auth.linkProfile(account.id, profile.id);
  }
  if (profile.photoStatus === "rejected") {
    return res.status(422).json({ error: profile.moderation?.reason || "photo rejected", profile: store.ownerView(profile, account.id) });
  }
  res.status(201).json(store.ownerView(profile, account.id));
});

app.get("/api/users", (req, res) => res.json(store.visible().map((u) => store.publicView(u, viewerId(req)))));
app.get("/api/users/:id", (req, res) => {
  const u = store.get(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(store.publicView(u, viewerId(req)));
});

// ---------- Matchups ----------
app.get("/api/matchup", (req, res) => {
  const me = myProfile(req);
  const gender = req.query.gender;
  let pool = store.visible().filter((u) => (!me || u.id !== me.id) && u.photo !== undefined);
  if (gender) pool = pool.filter((u) => u.gender === gender);
  if (pool.length < 2) return res.status(409).json({ error: "not enough profiles" });
  const a = weightedPick(pool);
  const b = weightedPick(pool, a.id);
  res.json({ a: store.publicView(a, viewerId(req)), b: store.publicView(b, viewerId(req)) });
});

app.post("/api/vote", requireProfile, (req, res) => {
  const { winnerId, loserId } = req.body || {};
  const winner = store.get(winnerId);
  const loser = store.get(loserId);
  if (!winner || !loser || winnerId === loserId || winnerId === req.profile.id || loserId === req.profile.id) {
    return res.status(400).json({ error: "invalid vote" });
  }
  recordVote(req.profile, winner, loser);
  let creditEarned = false;
  if (req.profile.votesCast % CREDIT_PER_VOTES === 0) {
    store.addCredits(req.profile.id, 1);
    creditEarned = true;
  }
  store.save();
  res.json({ ok: true, creditEarned, credits: req.profile.credits, votesCast: req.profile.votesCast });
});

// Your personal ranking of everyone you've rated (by how often you picked them).
app.get("/api/my-ranking", requireProfile, (req, res) => {
  const r = req.profile.ratings || {};
  const ranked = store.visible()
    .filter((u) => u.id !== req.profile.id && r[u.id])
    .map((u) => {
      const { w, l } = r[u.id];
      return { user: store.publicView(u, req.account.id), w, l, score: w - l, rate: w + l ? w / (w + l) : 0 };
    })
    .sort((a, b) => b.score - a.score || b.rate - a.rate)
    .slice(0, 30);
  res.json({ ranking: ranked, votesCast: req.profile.votesCast || 0 });
});

// ---------- Report & matches ----------
// "How people see this photo": attractiveness band, per-game guess reveals,
// and the gated "Who Likes You?" demographic report.
app.get("/api/report", requireProfile, (req, res) => {
  const me = req.profile;
  const pop = store.visible().some((u) => u.id === me.id) ? store.visible() : [...store.visible(), me];
  const base = report(me, pop);
  const band = attractivenessBand(me, pop);

  const games = GAMES.map((g) => {
    const consensus = guessConsensus(me, g);
    const revealed = !!me.revealed?.[g.key];
    return {
      key: g.key, label: g.label, emoji: g.emoji,
      ready: consensus.ready,
      revealed,
      // Only expose the consensus once the user has paid to reveal it.
      result: revealed && consensus.ready ? { pole: consensus.pole, pct: consensus.pct, total: consensus.total } : null,
      total: consensus.total,
    };
  });

  res.json({
    ...base,
    // The scatter is the whole platform at once, so it's built here where the
    // population is in hand. Dots carry no ids — just coordinates.
    moralityVsLooks: moralityVsLooks(pop, me),
    standing: standingOf(me, pop),
    credits: me.credits || 0,
    cost: COST,
    prediction: me.prediction ?? null,
    photoStatus: me.photoStatus || "pending",
    moderation: { reason: me.moderation?.reason || null, reviewedAt: me.moderation?.reviewedAt || null },
    nature: {
      ...store.moralReport(me),
      minAnswered: MORAL_MIN_ANSWERED,
      // Where your score sits against everyone who has finished the quiz.
      harsherThan: moralPercentile(me, pop),
    },
    votesCast: me.votesCast || 0,
    taste: tasteReport(me, pop),
    attractiveness: band,
    games,
    emailOnNewData: !!me.emailOnNewData,
    fans: {
      unlocked: !!me.fansUnlocked,
      cost: COST.fans,
      earnedTowardUnlock: me.credits || 0,
      report: me.fansUnlocked ? fansReport(me, pop) : null,
    },
  });
});

// ---------- Guessing games ----------
// Two-photo comparison: "who is more X". Returns two distinct targets.
app.get("/api/versus", (req, res) => {
  const axis = req.query.axis;
  if (!VERSUS_AXES.includes(axis)) return res.status(400).json({ error: "unknown axis" });
  const me = myProfile(req);
  let pool = store.visible().filter((u) => !me || u.id !== me.id);
  if (req.query.gender) pool = pool.filter((u) => u.gender === req.query.gender);
  if (pool.length < 2) return res.status(409).json({ error: "not enough profiles" });
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = pool[Math.floor(Math.random() * pool.length)];
  for (let g = 0; b.id === a.id && g < 50; g++) b = pool[Math.floor(Math.random() * pool.length)];
  res.json({ a: store.publicView(a, viewerId(req)), b: store.publicView(b, viewerId(req)), axis });
});

// Score a comparison: correct = picked the higher trait value.
app.post("/api/versus-guess", (req, res) => {
  const { axis, aId, bId, pick } = req.body || {};
  const a = store.get(aId), b = store.get(bId);
  if (!VERSUS_AXES.includes(axis) || !a || !b || (pick !== "a" && pick !== "b")) return res.status(400).json({ error: "invalid guess" });
  const va = axisValue(a, axis), vb = axisValue(b, axis);
  const higher = va >= vb ? "a" : "b";
  const correct = pick === higher;
  // Record each rater's directional guess about the two photos.
  const picked = pick === "a" ? a : b, other = pick === "a" ? b : a;
  store.recordGuessAbout(picked.id, axis, "high");
  store.recordGuessAbout(other.id, axis, "low");
  const me = myProfile(req);
  if (me) store.recordGuess(me.id, axis, correct);
  res.json({ correct, higher });
});

// ---------- Dilemma rounds ----------
// "You can only save one" (two photos) and "would you cheat for this person"
// (one photo). No right answer, so no accuracy tracking — these only ever
// aggregate onto the target, and they count toward the rating credit counter.
app.get("/api/dilemma", requireProfile, (req, res) => {
  const kind = req.query.kind;
  if (kind !== "death" && kind !== "cheat") return res.status(400).json({ error: "unknown dilemma" });
  let pool = store.visible().filter((u) => u.id !== req.profile.id);
  if (req.query.gender) pool = pool.filter((u) => u.gender === req.query.gender);
  const need = kind === "death" ? 2 : 1;
  if (pool.length < need) return res.status(409).json({ error: "not enough profiles" });

  const a = pool[Math.floor(Math.random() * pool.length)];
  if (kind === "cheat") return res.json({ kind, a: store.publicView(a, req.account.id) });
  let b = pool[Math.floor(Math.random() * pool.length)];
  for (let g = 0; b.id === a.id && g < 50; g++) b = pool[Math.floor(Math.random() * pool.length)];
  res.json({ kind, a: store.publicView(a, req.account.id), b: store.publicView(b, req.account.id) });
});

app.post("/api/dilemma", requireProfile, (req, res) => {
  const { kind, aId, bId, pick } = req.body || {};
  if (kind === "death") {
    const a = store.get(aId), b = store.get(bId);
    if (!a || !b || a.id === b.id || (pick !== "a" && pick !== "b")) return res.status(400).json({ error: "invalid choice" });
    const saved = pick === "a" ? a : b, left = pick === "a" ? b : a;
    store.recordDilemma(saved.id, "death", "saved");
    store.recordDilemma(left.id, "death", "left");
  } else if (kind === "cheat") {
    const a = store.get(aId);
    if (!a || (pick !== "yes" && pick !== "no")) return res.status(400).json({ error: "invalid choice" });
    store.recordDilemma(a.id, "cheat", pick);
  } else {
    return res.status(400).json({ error: "unknown dilemma" });
  }
  // Dilemmas are ratings too — they count toward the same credit grind.
  req.profile.votesCast = (req.profile.votesCast || 0) + 1;
  let creditEarned = false;
  if (req.profile.votesCast % CREDIT_PER_VOTES === 0) {
    store.addCredits(req.profile.id, 1);
    creditEarned = true;
  }
  store.save();
  res.json({ ok: true, creditEarned, credits: req.profile.credits, votesCast: req.profile.votesCast });
});

app.get("/api/guess", (req, res) => {
  const axis = req.query.axis;
  if (!GUESS_AXES.includes(axis)) return res.status(400).json({ error: "unknown axis" });
  const me = myProfile(req);
  const pool = store.visible().filter((u) => !me || u.id !== me.id);
  if (pool.length === 0) return res.status(409).json({ error: "no profiles" });
  const target = pool[Math.floor(Math.random() * pool.length)];
  res.json({ target: store.publicView(target, viewerId(req)), axis, poles: AXES[axis] || null });
});

app.post("/api/guess", (req, res) => {
  const { targetId, axis, guess } = req.body || {};
  const target = store.get(targetId);
  if (!target || !GUESS_AXES.includes(axis)) return res.status(400).json({ error: "invalid guess" });
  const outcome = guessOutcome(target, axis, guess);
  const me = myProfile(req);
  if (me) store.recordGuess(me.id, axis, outcome.correct);
  // Aggregate what strangers guess about the target (trait axes only).
  if (VERSUS_AXES.includes(axis) && (guess === "low" || guess === "high")) store.recordGuessAbout(targetId, axis, guess);
  res.json(outcome);
});

// Save one self-report answer (the game's "first, about you" step).
app.post("/api/answer", requireProfile, (req, res) => {
  const qid = String(req.body?.qid || "");
  const i = Number(req.body?.i);
  const bank = req.body?.bank === "moral" ? "moral" : "traits";
  const bankQuestions = bank === "moral" ? MORAL_QUESTIONS : QUESTIONS;
  if (!bankQuestions.some((q) => q.id === qid)) return res.status(400).json({ error: "unknown question" });
  store.setAnswer(req.profile.id, qid, i, bank);
  res.json({ ok: true });
});

const GAME_ROUNDS = 5;
const GAME_NEED = 3; // 3 of 5 correct
const GAME_REWARD = 2; // earns 2 credits
app.get("/api/game-config", (_req, res) => res.json({ rounds: GAME_ROUNDS, need: GAME_NEED, reward: GAME_REWARD }));
app.post("/api/games/reward", requireProfile, (req, res) => {
  const earned = Number(req.body?.correct) >= GAME_NEED; // 3 of 5
  if (earned) store.addCredits(req.profile.id, GAME_REWARD);
  res.json({ earned, reward: GAME_REWARD, credits: req.profile.credits });
});

app.get("/api/guess-stats", requireProfile, (req, res) => res.json(store.guessStats(req.profile.id)));

// ---------- Credit spending ----------
// Reveal what strangers guess about your photo on one game (costs credits).
app.post("/api/reveal", requireProfile, (req, res) => {
  const game = gameByKey(req.body?.game);
  if (!game) return res.status(400).json({ error: "unknown game" });
  if (req.profile.revealed?.[game.key]) return res.json({ ok: true, alreadyOwned: true, credits: req.profile.credits });
  if (!guessConsensus(req.profile, game).ready) return res.status(409).json({ error: "still collecting" });
  if (!store.spend(req.profile.id, COST.reveal)) return res.status(402).json({ error: "not enough credits", credits: req.profile.credits });
  store.reveal(req.profile.id, game.key);
  const c = guessConsensus(req.profile, game);
  res.json({ ok: true, credits: req.profile.credits, result: { pole: c.pole, pct: c.pct, total: c.total } });
});

// Unlock the full "Who Likes You?" demographic report.
app.post("/api/unlock-fans", requireProfile, (req, res) => {
  if (req.profile.fansUnlocked) return res.json({ ok: true, alreadyOwned: true, credits: req.profile.credits });
  if (!store.spend(req.profile.id, COST.fans)) return res.status(402).json({ error: "not enough credits", credits: req.profile.credits });
  store.unlockFans(req.profile.id);
  res.json({ ok: true, credits: req.profile.credits, report: fansReport(req.profile, store.visible()) });
});

// Buy more matchup pairs (more data, faster) — boosts how often your photo shows.
app.post("/api/buy-pairs", requireProfile, (req, res) => {
  if (!store.spend(req.profile.id, COST.pairs)) return res.status(402).json({ error: "not enough credits", credits: req.profile.credits });
  store.addPriorityPairs(req.profile.id, PAIRS_AMOUNT);
  res.json({ ok: true, credits: req.profile.credits, priorityPairs: req.profile.priorityPairs });
});

app.post("/api/email-pref", requireProfile, (req, res) => {
  store.setEmailPref(req.profile.id, req.body?.on);
  res.json({ ok: true, emailOnNewData: req.profile.emailOnNewData });
});

// ---------- Buy credits ----------
// ---------- Age / ID verification ----------
// See src/identity.js: the vendor holds the document, we keep a pass/fail.
app.get("/api/verify", requireProfile, (req, res) => {
  res.json({
    required: identity.REQUIRED,
    configured: identity.configured(),
    mode: identity.MODE, // "manual" | "vendor" | "none"
    provider: identity.MODE === "vendor" ? identity.PROVIDER : null,
    verified: !!req.profile.identity?.verified,
    verifiedAt: req.profile.identity?.verifiedAt || null,
    hasId: !!req.profile.idDoc,
    idRequested: !!req.profile.idRequested,
    blockedReason: identity.blockedReason(req.profile),
  });
});

app.post("/api/verify/start", requireProfile, async (req, res) => {
  if (req.profile.identity?.verified) return res.json({ ok: true, verified: true });
  try {
    const { url, reference } = await identity.start(req.profile, {
      returnUrl: `${req.protocol}://${req.get("host")}/?verified=1`,
    });
    res.json({ ok: true, url, reference });
  } catch (err) {
    if (err instanceof identity.VerificationError) return res.status(503).json({ error: err.message });
    throw err;
  }
});

// Poll the vendor for a terminal status. A webhook is better in production;
// this keeps the flow working without one.
app.post("/api/verify/check", requireProfile, async (req, res) => {
  const reference = String(req.body?.reference || "");
  if (!reference) return res.status(400).json({ error: "missing reference" });
  const out = await identity.resolve(reference);
  if (out.verified) {
    store.setVerified(req.profile.id, identity.verificationRecord({ method: out.method, reference }));
  }
  res.json({ status: out.status, verified: !!out.verified });
});

// ---------- Reports and takedowns ----------
// Deliberately open to signed-out visitors: the Terms say you shouldn't need an
// account to report your own face, and that has to be true in the code too.
app.get("/api/report-reasons", (_req, res) =>
  res.json({ reasons: Object.entries(reports.REASONS).map(([key, r]) => ({ key, ...r })) }));

app.post("/api/report", (req, res) => {
  const { targetId, reason, detail, contact } = req.body || {};
  const target = store.get(targetId);
  if (!target || !reports.REASONS[reason]) return res.status(400).json({ error: "invalid report" });
  const reporter = myProfile(req);
  const report = reports.file({ targetId, reason, detail, contact, reporterId: reporter?.id || null });

  // Urgent reasons hide the photo before a human looks at it.
  if (report.urgent) store.suspendPhoto(targetId, `reported: ${reports.REASONS[reason].label}`);
  store.save();
  res.status(201).json({
    ok: true,
    urgent: report.urgent,
    response: reports.REASONS[reason].response,
    hidden: report.urgent,
  });
});

app.get("/api/admin/reports", requireAdmin, (_req, res) => {
  res.json({
    open: reports.open().map((r) => ({ ...r, target: store.adminView(store.get(r.targetId), _req.account?.id) })),
    oldestOpenHours: reports.oldestOpenAgeHours(),
    total: reports.all().length,
  });
});

app.post("/api/admin/reports/:id", requireAdmin, (req, res) => {
  const { status, resolution } = req.body || {};
  const r = reports.resolve(req.params.id, { status, resolution, by: req.account.email });
  if (!r) return res.status(400).json({ error: "invalid resolution" });
  res.json(r);
});

// ---------- The Top 10 ----------
// Visible to every signed-in user, with no opt-out: appearing here is a term of
// putting your face in the pool (legal/terms.md §6). Not on the open web —
// photos still go out only through expiring, per-viewer links.
const BOARDS_ENABLED = process.env.BOARDS_ENABLED !== "0";

app.get("/api/leaderboard", requireProfile, (req, res) => {
  if (!BOARDS_ENABLED) return res.status(503).json({ error: "the leaderboard is switched off" });
  const pop = store.visible();

  // A row carries the participant card — photo plus whatever socials they chose
  // to link. This is the payoff for making it.
  const decorate = (rows) => rows.map((r) => {
    const u = store.get(r.id);
    return { ...r, ...store.participantView(u, req.account.id), you: r.id === req.profile.id };
  });

  res.json({
    minMatchups: BOARD_MIN_MATCHUPS,
    boards: boardGenders(pop).map((gender) => {
      const board = topTen(pop, gender, { limit: 10 });
      return { ...board, rows: decorate(board.rows) };
    }),
    // Everyone who has a live photo sees where they stand, in or out of the ten.
    you: standingOf(req.profile, pop),
    isParticipant: isParticipant(req.profile),
  });
});

// ---------- Admin: photo approval queue ----------
// Nothing is ever auto-approved — every photo waits here for a human decision.
app.get("/api/admin/queue", requireAdmin, (req, res) => {
  const q = store.moderationQueue({ limit: 100 });
  res.json({
    pending: q.pending.map((u) => store.adminView(u, req.account.id)),
    decided: q.decided.map((u) => store.adminView(u, req.account.id)),
  });
});

// Mark an account verified by hand — the fallback when no vendor is wired up,
// and the override when a vendor gets it wrong.
app.get("/api/admin/id/:id", requireAdmin, (req, res) => {
  const docId = store.idDocOf(req.params.id);
  if (!docId) return res.status(404).end();
  const buf = photos.get(docId);
  if (!buf) return res.status(404).end();
  res.set({
    "Content-Type": "image/jpeg",
    "Content-Length": String(buf.length),
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, noimageindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(buf);
});

app.post("/api/admin/verify/:id", requireAdmin, (req, res) => {
  const target = store.get(req.params.id);
  if (!target) return res.status(404).json({ error: "not found" });
  const on = req.body?.verified !== false;
  store.setVerified(target.id, on
    ? identity.verificationRecord({ method: "manual", reference: `admin:${req.account.email}` })
    : { verified: false, verifiedAt: null, method: null, reference: null });
  res.json(store.adminView(target, req.account.id));
});

app.post("/api/admin/photo/:id", requireAdmin, (req, res) => {
  const { action, reason } = req.body || {};
  // "request-id" is the escalation that keeps us from collecting ID from
  // everyone: ask only when a reviewer isn't sure about someone's age.
  if (action === "request-id") {
    const updated = store.requestId(req.params.id, req.account.email);
    if (!updated) return res.status(404).json({ error: "not found" });
    return res.json(store.adminView(updated, req.account.id));
  }
  if (!["approve", "reject", "escalate"].includes(action)) return res.status(400).json({ error: "unknown action" });
  const updated = store.moderatePhoto(req.params.id, action, reason, req.account.email);
  if (!updated) return res.status(404).json({ error: "not found" });
  if (action === "approve" && updated.photoStatus !== "approved") {
    // Surface the store's own reason — "waiting on their ID" is far more use to
    // a reviewer than a generic refusal.
    return res.status(409).json({
      error: updated.moderation?.reason || identity.blockedReason(updated) || "cannot approve",
      profile: store.adminView(updated, req.account.id),
    });
  }
  res.json(store.adminView(updated, req.account.id));
});

app.get("/api/credit-packs", (_req, res) => res.json({ packs: CREDIT_PACKS }));

// Purchase a pack. NOTE: demo checkout — no real payment processor is wired,
// so this simply grants the credits. Swap in Stripe/etc. for real billing.
app.post("/api/buy-credits", requireProfile, (req, res) => {
  const pack = CREDIT_PACKS.find((p) => p.id === req.body?.packId);
  if (!pack) return res.status(400).json({ error: "unknown pack" });
  store.addCredits(req.profile.id, pack.credits);
  res.json({ ok: true, demo: true, added: pack.credits, credits: req.profile.credits });
});

// Weighted pick: profiles with unspent purchased priority appear more often.
function weightedPick(pool, exclude) {
  const cands = pool.filter((u) => u.id !== exclude);
  const weight = (u) => 1 + ((u.priorityPairs || 0) > 0 && (u.matchups || 0) < (400 + u.priorityPairs) ? 9 : 0);
  const total = cands.reduce((s, u) => s + weight(u), 0);
  let r = Math.random() * total;
  for (const u of cands) { r -= weight(u); if (r <= 0) return u; }
  return cands[0];
}

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, HOST, () => console.log(`TrueHumanNature running on http://${HOST}:${PORT}`));
}

export default app;
