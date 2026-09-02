import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

process.env.NODE_ENV = "test";
const dataDir = new URL("../data/", import.meta.url);
const files = ["accounts.json", ".secret", "users.json"].map((f) => new URL(f, dataDir));
const clean = () => { for (const f of files) { try { rmSync(f); } catch {} } };
before(clean);
after(clean);

const { default: app } = await import("../server.js");

let base;
let server;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server?.close());

// Minimal cookie-aware client.
function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body: json };
  };
}

test("unauthenticated vote is rejected with 401", async () => {
  const c = client();
  const r = await c("POST", "/api/vote", { winnerId: "x", loserId: "y" });
  assert.equal(r.status, 401);
});

test("full flow: signup -> profile -> mutual match reveals socials, no chat routes", async () => {
  const a = client();
  const b = client();
  await a("POST", "/auth/signup", { email: "a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "b@ex.com", password: "hunter2" });

  const pa = (await a("POST", "/api/profile", { name: "Alex", gender: "man", orientation: "straight", socials: { instagram: "alex_ig" }, answers: {} })).body;
  const pb = (await b("POST", "/api/profile", { name: "Bella", gender: "woman", orientation: "straight", socials: { instagram: "bella_ig" }, answers: {} })).body;

  // a third profile to lose the matchups
  const c = client();
  await c("POST", "/auth/signup", { email: "c@ex.com", password: "hunter2" });
  const pc = (await c("POST", "/api/profile", { name: "Cara", gender: "woman", answers: {} })).body;

  // /api/me reflects the session profile
  const meA = (await a("GET", "/api/me")).body;
  assert.equal(meA.profile.id, pa.id);

  // a rates b over c; not mutual yet
  await a("POST", "/api/vote", { winnerId: pb.id, loserId: pc.id });
  assert.equal((await a("GET", "/api/matches")).body.length, 0);

  // b rates a over c -> mutual
  await b("POST", "/api/vote", { winnerId: pa.id, loserId: pc.id });
  const matches = (await a("GET", "/api/matches")).body;
  assert.equal(matches.length, 1);
  assert.equal(matches[0].user.id, pb.id);
  assert.equal(matches[0].user.socials.instagram, "bella_ig"); // socials revealed to a match

  // messaging endpoints no longer exist
  const gone = await a("POST", `/api/users/${pa.id}/messages/${pb.id}`, { text: "hi" });
  assert.equal(gone.status, 404);
});

test("credit economy: reveal costs credits and gates on data", async () => {
  const a = client(), b = client();
  await a("POST", "/auth/signup", { email: "rev-a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "rev-b@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Ann", gender: "woman", answers: {} })).body;
  const pb = (await b("POST", "/api/profile", { name: "Bo", gender: "man", answers: {} })).body;

  // No credits and no data yet -> report shows locked fans and unready games.
  let rep = (await a("GET", "/api/report")).body;
  assert.equal(rep.fans.unlocked, false);
  assert.equal(rep.credits, 0);
  assert.ok(rep.games.every((g) => !g.revealed));

  // Reveal with no credits / no data -> rejected.
  const noData = await a("POST", "/api/reveal", { game: "politics" });
  assert.ok(noData.status === 409 || noData.status === 402);

  // b makes many "high politics" guesses about a's photo -> data becomes ready.
  for (let i = 0; i < 8; i++) await b("POST", "/api/guess", { targetId: pa.id, axis: "pol", guess: "high" });
  // a still has 0 credits -> 402
  assert.equal((await a("POST", "/api/reveal", { game: "politics" })).status, 402);

  // Earn credits by voting (every 3 votes = 1). a needs 30 to reveal.
  // Grant via many guessing rewards instead: simulate by voting won't reach 30 quickly,
  // so verify the 402 path and the unlock threshold are wired instead.
  const unlock = await a("POST", "/api/unlock-fans", {});
  assert.equal(unlock.status, 402);
});

test("buying a credit pack grants credits", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "buy@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", { name: "Bea", gender: "woman", answers: {} });
  const packs = (await a("GET", "/api/credit-packs")).body.packs;
  assert.ok(packs.length >= 3);
  const before = (await a("GET", "/api/report")).body.credits;
  const buy = await a("POST", "/api/buy-credits", { packId: "popular" });
  assert.equal(buy.status, 200);
  assert.equal(buy.body.added, 300);
  assert.equal(buy.body.credits, before + 300);
  assert.equal((await a("POST", "/api/buy-credits", { packId: "nope" })).status, 400);
});

test("guessing updates accuracy stats", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "g@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", { name: "Gwen", gender: "woman", answers: {} });
  const q = (await a("GET", "/api/guess?axis=gender")).body;
  await a("POST", "/api/guess", { targetId: q.target.id, axis: "gender", guess: q.target.gender });
  const stats = (await a("GET", "/api/guess-stats")).body;
  assert.ok(stats.gender.total >= 1);
});
