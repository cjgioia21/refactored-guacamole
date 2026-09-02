// StudyMatch — attraction-based matchmaking server.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as store from "./src/store.js";
import { QUESTIONS, AXES } from "./src/questions.js";
import {
  recordVote, report, guessOutcome, matchScore, findMatches,
  GENDERS, ORIENTATIONS, MH_FLAGS,
} from "./src/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

const CREDIT_PER_VOTES = 3;
const GUESS_AXES = [...Object.keys(AXES), "age", "gender", "mh"];

// --- Meta / questionnaire ---
app.get("/api/questions", (_req, res) => res.json({ questions: QUESTIONS, axes: AXES }));
app.get("/api/meta", (_req, res) =>
  res.json({ axes: AXES, genders: GENDERS, orientations: ORIENTATIONS, mentalHealth: MH_FLAGS, guessAxes: GUESS_AXES, creditPerVotes: CREDIT_PER_VOTES })
);

// --- Profiles ---
app.post("/api/users", (req, res) => {
  if (!String(req.body?.name || "").trim()) return res.status(400).json({ error: "name is required" });
  res.status(201).json(store.publicView(store.create(req.body)));
});

app.get("/api/users", (_req, res) => res.json(store.all().map(store.publicView)));

app.get("/api/users/:id", (req, res) => {
  const u = store.get(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(store.publicView(u));
});

app.put("/api/users/:id", (req, res) => {
  const u = store.update(req.params.id, req.body || {});
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(store.publicView(u));
});

app.delete("/api/users/:id", (req, res) => {
  if (!store.remove(req.params.id)) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// --- Matchups (choose the more attractive photo) ---
app.get("/api/matchup", (req, res) => {
  const pool = store.all().filter((u) => u.id !== req.query.voter);
  if (pool.length < 2) return res.status(409).json({ error: "not enough profiles" });
  const [a, b] = pickTwo(pool);
  res.json({ a: store.publicView(a), b: store.publicView(b) });
});

app.post("/api/vote", (req, res) => {
  const { voterId, winnerId, loserId } = req.body || {};
  const voter = store.get(voterId);
  const winner = store.get(winnerId);
  const loser = store.get(loserId);
  if (!voter || !winner || !loser || winnerId === loserId) return res.status(400).json({ error: "invalid vote" });
  recordVote(voter, winner, loser);
  let creditEarned = false;
  if (voter.votesCast % CREDIT_PER_VOTES === 0) {
    store.addCredits(voter.id, 1);
    creditEarned = true;
  }
  store.save();
  res.json({ ok: true, creditEarned, credits: voter.credits, winnerElo: Math.round(winner.elo) });
});

// --- Reports & matchmaking ---
app.get("/api/users/:id/report", (req, res) => {
  const u = store.get(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  res.json(report(u, store.all()));
});

app.get("/api/users/:id/matches", (req, res) => {
  const u = store.get(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  res.json(
    findMatches(u, store.all(), { limit }).map((m) => ({
      user: store.publicView(m.user),
      score: m.score,
      youLikeThem: m.aLikesB,
      theyLikeYou: m.bLikesA,
    }))
  );
});

app.get("/api/match/:a/:b", (req, res) => {
  const a = store.get(req.params.a);
  const b = store.get(req.params.b);
  if (!a || !b) return res.status(404).json({ error: "not found" });
  res.json(matchScore(a, b, store.all()));
});

// --- Social-media sharing (replaces messaging) ---
app.post("/api/users/:id/share", (req, res) => {
  const result = store.share(req.params.id, req.body?.targetId);
  if (!result) return res.status(400).json({ error: "invalid share" });
  res.json(result); // { mutual }
});

app.get("/api/users/:id/connections", (req, res) => {
  const conns = store.connections(req.params.id);
  if (conns == null) return res.status(404).json({ error: "not found" });
  res.json(conns);
});

// --- Guessing games ---
app.get("/api/guess", (req, res) => {
  const axis = req.query.axis;
  if (!GUESS_AXES.includes(axis)) return res.status(400).json({ error: "unknown axis" });
  const pool = store.all().filter((u) => u.id !== req.query.voter);
  if (pool.length === 0) return res.status(409).json({ error: "no profiles" });
  const target = pool[Math.floor(Math.random() * pool.length)];
  res.json({ target: store.publicView(target), axis, poles: AXES[axis] || null });
});

app.post("/api/guess", (req, res) => {
  const { targetId, axis, guess } = req.body || {};
  const target = store.get(targetId);
  if (!target || !GUESS_AXES.includes(axis)) return res.status(400).json({ error: "invalid guess" });
  res.json(guessOutcome(target, axis, guess));
});

app.post("/api/games/reward", (req, res) => {
  const voter = store.get(req.body?.voterId);
  if (!voter) return res.status(404).json({ error: "not found" });
  const earned = Number(req.body?.correct) >= 2;
  if (earned) store.addCredits(voter.id, 1);
  res.json({ earned, credits: voter.credits });
});

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
