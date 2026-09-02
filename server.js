// StudyMatch — attraction-based matchmaking server with accounts.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import * as store from "./src/store.js";
import * as auth from "./src/auth.js";
import { QUESTIONS, AXES } from "./src/questions.js";
import { recordVote, report, guessOutcome, matchScore, mutualMatches, likes } from "./src/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

const CREDIT_PER_VOTES = 3;
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
  res.json({ axes: AXES, guessAxes: GUESS_AXES, creditPerVotes: CREDIT_PER_VOTES })
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
  const [a, b] = pickTwo(pool);
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
  res.json({ ok: true, creditEarned, credits: req.profile.credits });
});

// ---------- Report & matches ----------
app.get("/api/report", requireProfile, (req, res) => res.json(report(req.profile, store.all())));

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
  res.json(outcome);
});

app.post("/api/games/reward", requireProfile, (req, res) => {
  const earned = Number(req.body?.correct) >= 2;
  if (earned) store.addCredits(req.profile.id, 1);
  res.json({ earned, credits: req.profile.credits });
});

app.get("/api/guess-stats", requireProfile, (req, res) => res.json(store.guessStats(req.profile.id)));

function pickTwo(pool) {
  const i = Math.floor(Math.random() * pool.length);
  let j = Math.floor(Math.random() * pool.length);
  while (j === i) j = Math.floor(Math.random() * pool.length);
  return [pool[i], pool[j]];
}

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => console.log(`StudyMatch running on http://localhost:${PORT}`));
}

export default app;
