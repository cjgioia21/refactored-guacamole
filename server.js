// StudyMatch — attraction-based matchmaking server with accounts.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import * as store from "./src/store.js";
import * as auth from "./src/auth.js";
import { QUESTIONS, AXES } from "./src/questions.js";
import {
  recordVote, report, guessOutcome, matchScore, mutualMatches, likes,
  GAMES, gameByKey, attractivenessBand, guessConsensus, fansReport, tasteReport, TASTES,
} from "./src/engine.js";

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

app.use(express.json({ limit: "1mb" })); // room for small uploaded data: URLs
app.use(express.static(join(__dirname, "public")));

const CREDIT_PER_VOTES = 50; // 1 credit per 50 ratings — credits are scarce
const GUESS_AXES = [...Object.keys(AXES), "age", "gender", "mh"];
const oauthStates = new Set();

// Resolve the signed-in account's profile (or null).
function myProfile(req) {
  const account = auth.currentAccount(req);
  return account && account.profileId ? store.get(account.profileId) : null;
}
// Require an onboarded profile; 401/409 otherwise. Sets req.profile.
function requireProfile(req, res, next) {
  const account = auth.currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });
  const profile = account.profileId ? store.get(account.profileId) : null;
  if (!profile) return res.status(409).json({ error: "no profile yet" });
  req.account = account;
  req.profile = profile;
  next();
}

// ---------- Auth ----------
app.post("/auth/signup", (req, res) => {
  const { email, password } = req.body || {};
  const r = auth.signup(email, password);
  if (r.error) return res.status(400).json({ error: r.error });
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

app.get("/auth/config", (_req, res) => res.json({ google: auth.googleConfigured() }));

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
  res.json({ account: auth.publicAccount(account), profile: profile ? store.publicView(profile) : null });
});

// ---------- Questionnaire / meta ----------
app.get("/api/questions", (_req, res) => res.json({ questions: QUESTIONS, axes: AXES }));
app.get("/api/meta", (_req, res) =>
  res.json({ axes: AXES, guessAxes: GUESS_AXES, games: GAMES, cost: COST, pairsAmount: PAIRS_AMOUNT,
    tastes: TASTES.map((t) => ({ key: t.key, title: t.title, unlockAt: t.unlockAt })),
    creditPerVotes: CREDIT_PER_VOTES, game: { rounds: GAME_ROUNDS, need: GAME_NEED, reward: GAME_REWARD } })
);

// ---------- Profile (owned by the session account) ----------
app.post("/api/profile", (req, res) => {
  const account = auth.currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });
  let profile;
  if (account.profileId && store.get(account.profileId)) {
    profile = store.update(account.profileId, req.body || {});
  } else {
    profile = store.create({ ...req.body, accountId: account.id });
    auth.linkProfile(account.id, profile.id);
  }
  res.status(201).json(store.publicView(profile));
});

app.get("/api/users", (_req, res) => res.json(store.all().map(store.publicView)));
app.get("/api/users/:id", (req, res) => {
  const u = store.get(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(store.publicView(u));
});

// ---------- Matchups ----------
app.get("/api/matchup", (req, res) => {
  const me = myProfile(req);
  const gender = req.query.gender;
  let pool = store.all().filter((u) => (!me || u.id !== me.id) && u.photo !== undefined);
  if (gender) pool = pool.filter((u) => u.gender === gender);
  if (pool.length < 2) return res.status(409).json({ error: "not enough profiles" });
  const a = weightedPick(pool);
  const b = weightedPick(pool, a.id);
  res.json({ a: store.publicView(a), b: store.publicView(b) });
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

// ---------- Report & matches ----------
// "How people see this photo": attractiveness band, per-game guess reveals,
// and the gated "Who Likes You?" demographic report.
app.get("/api/report", requireProfile, (req, res) => {
  const me = req.profile;
  const pop = store.all();
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
    credits: me.credits || 0,
    cost: COST,
    prediction: me.prediction ?? null,
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

// Mutual matches: you both rated each other over other people -> socials revealed.
app.get("/api/matches", requireProfile, (req, res) => {
  res.json(
    mutualMatches(req.profile, store.all(), { limit: 30 }).map((m) => ({
      user: store.matchView(m.user),
      youPickRate: m.youPickRate,
      theyPickRate: m.theyPickRate,
      strength: m.strength,
    }))
  );
});

app.get("/api/match/:a/:b", (req, res) => {
  const a = store.get(req.params.a);
  const b = store.get(req.params.b);
  if (!a || !b) return res.status(404).json({ error: "not found" });
  res.json({ ...matchScore(a, b, store.all()), mutual: likes(a, b.id) && likes(b, a.id) });
});

// ---------- Guessing games ----------
// Two-photo comparison: "who is more X". Returns two distinct targets.
app.get("/api/versus", (req, res) => {
  const axis = req.query.axis;
  if (!AXES[axis]) return res.status(400).json({ error: "unknown axis" });
  const me = myProfile(req);
  let pool = store.all().filter((u) => !me || u.id !== me.id);
  if (req.query.gender) pool = pool.filter((u) => u.gender === req.query.gender);
  if (pool.length < 2) return res.status(409).json({ error: "not enough profiles" });
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b = pool[Math.floor(Math.random() * pool.length)];
  for (let g = 0; b.id === a.id && g < 50; g++) b = pool[Math.floor(Math.random() * pool.length)];
  res.json({ a: store.publicView(a), b: store.publicView(b), axis });
});

// Score a comparison: correct = picked the higher trait value.
app.post("/api/versus-guess", (req, res) => {
  const { axis, aId, bId, pick } = req.body || {};
  const a = store.get(aId), b = store.get(bId);
  if (!AXES[axis] || !a || !b || (pick !== "a" && pick !== "b")) return res.status(400).json({ error: "invalid guess" });
  const va = a.traits[axis] || 0, vb = b.traits[axis] || 0;
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

app.get("/api/guess", (req, res) => {
  const axis = req.query.axis;
  if (!GUESS_AXES.includes(axis)) return res.status(400).json({ error: "unknown axis" });
  const me = myProfile(req);
  const pool = store.all().filter((u) => !me || u.id !== me.id);
  if (pool.length === 0) return res.status(409).json({ error: "no profiles" });
  const target = pool[Math.floor(Math.random() * pool.length)];
  res.json({ target: store.publicView(target), axis, poles: AXES[axis] || null });
});

app.post("/api/guess", (req, res) => {
  const { targetId, axis, guess } = req.body || {};
  const target = store.get(targetId);
  if (!target || !GUESS_AXES.includes(axis)) return res.status(400).json({ error: "invalid guess" });
  const outcome = guessOutcome(target, axis, guess);
  const me = myProfile(req);
  if (me) store.recordGuess(me.id, axis, outcome.correct);
  // Aggregate what strangers guess about the target (trait axes only).
  if (AXES[axis] && (guess === "low" || guess === "high")) store.recordGuessAbout(targetId, axis, guess);
  res.json(outcome);
});

// Save one self-report answer (the game's "first, about you" step).
app.post("/api/answer", requireProfile, (req, res) => {
  const qid = String(req.body?.qid || "");
  const i = Number(req.body?.i);
  if (!QUESTIONS.some((q) => q.id === qid)) return res.status(400).json({ error: "unknown question" });
  store.setAnswer(req.profile.id, qid, i);
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
  res.json({ ok: true, credits: req.profile.credits, report: fansReport(req.profile, store.all()) });
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
  app.listen(PORT, () => console.log(`TrueHumanNature running on http://localhost:${PORT}`));
}

export default app;
