// StudyMatch — attraction-based matchmaking server.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as store from "./src/store.js";
import { QUESTIONS, AXES } from "./src/questions.js";
import {
  recordVote, report, guessOutcome, matchScore, mutualMatches, likes,
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

// Mutual matches: you both rated each other over other people.
app.get("/api/users/:id/matches", (req, res) => {
  const u = store.get(req.params.id);
  if (!u) return res.status(404).json({ error: "not found" });
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  res.json(
    mutualMatches(u, store.all(), { limit }).map((m) => ({
      user: store.matchView(m.user), // matched -> socials revealed
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

// --- Messaging (only between mutually-matched users) ---
function requireMatch(aId, bId) {
  const a = store.get(aId);
  const b = store.get(bId);
  if (!a || !b) return { error: 404 };
  if (!(likes(a, b.id) && likes(b, a.id))) return { error: 403 };
  return { a, b };
}

app.get("/api/users/:id/messages/:otherId", (req, res) => {
  const m = requireMatch(req.params.id, req.params.otherId);
  if (m.error) return res.status(m.error).json({ error: m.error === 403 ? "not matched" : "not found" });
  res.json(store.thread(req.params.id, req.params.otherId));
});

app.post("/api/users/:id/messages/:otherId", (req, res) => {
  const m = requireMatch(req.params.id, req.params.otherId);
  if (m.error) return res.status(m.error).json({ error: m.error === 403 ? "not matched" : "not found" });
  const thread = store.addMessage(req.params.id, req.params.otherId, req.body?.text);
  if (!thread) return res.status(400).json({ error: "empty message" });
  res.json(thread);
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
