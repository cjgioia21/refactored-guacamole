// StudyMatch — study-partner matchmaking server.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as store from "./src/store.js";
import { findMatches, pairAll, compatibility, META } from "./src/matchmaking.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// --- Users ---
app.get("/api/users", (_req, res) => res.json(store.all()));

app.get("/api/users/:id", (req, res) => {
  const user = store.get(req.params.id);
  if (!user) return res.status(404).json({ error: "not found" });
  res.json(user);
});

app.post("/api/users", (req, res) => {
  if (!req.body || !String(req.body.name || "").trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  res.status(201).json(store.create(req.body));
});

app.put("/api/users/:id", (req, res) => {
  const user = store.update(req.params.id, req.body || {});
  if (!user) return res.status(404).json({ error: "not found" });
  res.json(user);
});

app.delete("/api/users/:id", (req, res) => {
  if (!store.remove(req.params.id)) {
    return res.status(404).json({ error: "not found" });
  }
  res.status(204).end();
});

// --- Matchmaking ---
app.get("/api/users/:id/matches", (req, res) => {
  const user = store.get(req.params.id);
  if (!user) return res.status(404).json({ error: "not found" });
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const minScore = Number(req.query.minScore) || 1;
  res.json(findMatches(user, store.all(), { limit, minScore }));
});

app.get("/api/compatibility/:a/:b", (req, res) => {
  const a = store.get(req.params.a);
  const b = store.get(req.params.b);
  if (!a || !b) return res.status(404).json({ error: "not found" });
  res.json(compatibility(a, b));
});

app.get("/api/pairings", (req, res) => {
  const minScore = Number(req.query.minScore) || 1;
  const { pairs, unpaired } = pairAll(store.all(), { minScore });
  res.json({
    pairs: pairs.map((p) => ({
      a: { id: p.a.id, name: p.a.name },
      b: { id: p.b.id, name: p.b.name },
      score: p.score,
    })),
    unpaired: unpaired.map((u) => ({ id: u.id, name: u.name })),
  });
});

app.get("/api/meta", (_req, res) => res.json(META));

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`StudyMatch running on http://localhost:${PORT}`);
  });
}

export default app;
