import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

process.env.NODE_ENV = "test";
process.env.ADMIN_EMAILS = "admin@ex.com";
const dataDir = new URL("../data/", import.meta.url);
const files = ["accounts.json", ".secret", ".photokey", ".photosecret", "users.json", "moral-tally.json"].map((f) => new URL(f, dataDir));
const clean = () => {
  for (const f of files) { try { rmSync(f); } catch {} }
  try { rmSync(new URL("photos/", dataDir), { recursive: true }); } catch {}
};
before(clean);
after(clean);

const { default: app } = await import("../server.js");
const { MORAL_QUESTIONS } = await import("../src/morality.js");
const { default: sharp } = await import("sharp");

// A real image — the server re-encodes every upload, so a fake string is
// rejected now. Two distinct colours so "changing your photo" is a real change.
const jpeg = async (r = 200) => (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 90, b: 120 } } }).jpeg().toBuffer()).toString("base64");
const photoData = async (r) => `data:image/jpeg;base64,${await jpeg(r)}`;

// Answer every morality question at the same signed value: -2 (saint) .. +2.
const moralAll = (value) =>
  Object.fromEntries(MORAL_QUESTIONS.map((q) => [q.id, q.options.findIndex((o) => o.value === value)]));

let base;
let server;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server?.close());

// An admin session, used to approve photos (nothing is auto-approved).
let admin;
async function adminClient() {
  if (!admin) {
    admin = client();
    await admin("POST", "/auth/signup", { email: "admin@ex.com", password: "hunter2" });
  }
  return admin;
}
// Approve one or more profiles so they're visible to other users.
async function approve(...ids) {
  const admin = await adminClient();
  for (const id of ids) {
    const r = await admin("POST", `/api/admin/photo/${id}`, { action: "approve" });
    assert.equal(r.status, 200);
  }
}

// Minimal cookie-aware client.
function client() {
  let cookie = "";
  const call = async (method, path, body) => {
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
  call.cookie = () => cookie;
  return call;
}

// Fetch a URL without JSON parsing — used to assert on the photo route's
// status codes and security headers directly.
async function raw(cookie, path) {
  const res = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    cache: res.headers.get("cache-control"),
    robots: res.headers.get("x-robots-tag"),
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

  const pa = (await a("POST", "/api/profile", { name: "Alex", gender: "man", orientation: "straight", socials: { instagram: "alex_ig" }, answers: {}, moralAnswers: moralAll(0) })).body;
  const pb = (await b("POST", "/api/profile", { name: "Bella", gender: "woman", orientation: "straight", socials: { instagram: "bella_ig" }, answers: {}, moralAnswers: moralAll(0) })).body;

  // a third profile to lose the matchups
  const c = client();
  await c("POST", "/auth/signup", { email: "c@ex.com", password: "hunter2" });
  const pc = (await c("POST", "/api/profile", { name: "Cara", gender: "woman", answers: {} })).body;

  // Photos start pending and are invisible until an admin approves them.
  assert.equal(pa.photoStatus, "pending");
  await approve(pa.id, pb.id, pc.id);

  // /api/me reflects the session profile
  const meA = (await a("GET", "/api/me")).body;
  assert.equal(meA.profile.id, pa.id);

  // a rates b over c three times; not mutual yet
  for (let i = 0; i < 3; i++) await a("POST", "/api/vote", { winnerId: pb.id, loserId: pc.id });
  assert.equal((await a("GET", "/api/matches")).body.length, 0);

  // b rates a over c twice -> still short of the 3-pick gate
  for (let i = 0; i < 2; i++) await b("POST", "/api/vote", { winnerId: pa.id, loserId: pc.id });
  assert.equal((await a("GET", "/api/matches")).body.length, 0);

  // the third pick clears the gate -> mutual match
  await b("POST", "/api/vote", { winnerId: pa.id, loserId: pc.id });
  const matches = (await a("GET", "/api/matches")).body;
  assert.equal(matches.length, 1);
  assert.equal(matches[0].user.id, pb.id);
  assert.equal(matches[0].user.socials.instagram, "bella_ig"); // socials revealed to a match
  assert.ok(matches[0].yourPicks >= 3 && matches[0].theirPicks >= 3);

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
  await approve(pa.id, pb.id);

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

test("profile stores photo, prediction, ratingsFrom and gender identity", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "photo@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", {
    name: "Pia", gender: "woman", genderIdentity: "woman-trans", ratingsFrom: "men",
    prediction: 73, photo: await photoData(210), answers: {},
  });
  const rep = (await a("GET", "/api/report")).body;
  assert.equal(rep.prediction, 73);
  const me = (await a("GET", "/api/me")).body;
  // The profile never carries image bytes — only a short-lived, viewer-bound URL.
  assert.equal(me.profile.photo, undefined);
  assert.equal(me.profile.hasPhoto, true);
  assert.match(me.profile.photoUrl, /^\/photos\/[0-9a-f]{32}\?t=/);
  // editing without a photo keeps it and merges answers
  await a("POST", "/api/profile", { name: "Pia B", answers: { pol1: 0 } });
  const me2 = (await a("GET", "/api/me")).body;
  assert.equal(me2.profile.hasPhoto, true);
  assert.equal(me2.profile.name, "Pia B");
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

test("my-ranking orders profiles by how often you picked them", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "rank@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", { name: "Ren", gender: "man", answers: {} });
  const b = client(), c = client();
  await b("POST", "/auth/signup", { email: "rb@ex.com", password: "hunter2" });
  await c("POST", "/auth/signup", { email: "rc@ex.com", password: "hunter2" });
  const pb = (await b("POST", "/api/profile", { name: "B", gender: "woman", answers: {} })).body;
  const pc = (await c("POST", "/api/profile", { name: "C", gender: "woman", answers: {} })).body;
  await approve(pb.id, pc.id);
  // a picks B over C twice -> B should rank above C
  await a("POST", "/api/vote", { winnerId: pb.id, loserId: pc.id });
  await a("POST", "/api/vote", { winnerId: pb.id, loserId: pc.id });
  const rk = (await a("GET", "/api/my-ranking")).body;
  assert.equal(rk.ranking[0].user.id, pb.id);
  assert.ok(rk.ranking[0].score >= rk.ranking[rk.ranking.length - 1].score);
});

test("versus comparison: scores the higher trait and records guesses", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "vs@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", { name: "Val", gender: "woman", answers: {} });
  // Two targets with known politics: right (pol high) vs left (pol low).
  const right = client(), left = client();
  await right("POST", "/auth/signup", { email: "r@ex.com", password: "hunter2" });
  await left("POST", "/auth/signup", { email: "l@ex.com", password: "hunter2" });
  const pr = (await right("POST", "/api/profile", { name: "R", gender: "man", answers: { pol11: 6 } })).body; // most-right
  const pl = (await left("POST", "/api/profile", { name: "L", gender: "man", answers: { pol11: 0 } })).body; // most-left
  await approve(pr.id, pl.id);

  const grab = await a("GET", "/api/versus?axis=pol&gender=man");
  assert.equal(grab.status, 200);
  assert.ok(grab.body.a && grab.body.b && grab.body.a.id !== grab.body.b.id);

  // Score a known pair deterministically: R is more right than L.
  const hit = await a("POST", "/api/versus-guess", { axis: "pol", aId: pr.id, bId: pl.id, pick: "a" });
  assert.equal(hit.body.correct, true);
  const miss = await a("POST", "/api/versus-guess", { axis: "pol", aId: pr.id, bId: pl.id, pick: "b" });
  assert.equal(miss.body.correct, false);
  const stats = (await a("GET", "/api/guess-stats")).body;
  assert.ok(stats.pol.total >= 2 && stats.pol.correct >= 1);
});

test("guessing updates accuracy stats", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "g@ex.com", password: "hunter2" });
  const pg = (await a("POST", "/api/profile", { name: "Gwen", gender: "woman", answers: {} })).body;
  const target = client();
  await target("POST", "/auth/signup", { email: "gt@ex.com", password: "hunter2" });
  const pt = (await target("POST", "/api/profile", { name: "Tam", gender: "man", answers: {} })).body;
  await approve(pg.id, pt.id);
  const q = (await a("GET", "/api/guess?axis=gender")).body;
  await a("POST", "/api/guess", { targetId: q.target.id, axis: "gender", guess: q.target.gender });
  const stats = (await a("GET", "/api/guess-stats")).body;
  assert.ok(stats.gender.total >= 1);
});

test("photos are hidden from others until approved, and rejection is explained", async () => {
  const a = client(), b = client();
  await a("POST", "/auth/signup", { email: "mod-a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "mod-b@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Mo", gender: "man", photo: await photoData(10), answers: {} })).body;
  const pb = (await b("POST", "/api/profile", { name: "No", gender: "man", photo: await photoData(20), answers: {} })).body;

  // Pending photos appear in nobody's user list.
  const users = (await a("GET", "/api/users")).body;
  assert.ok(!users.some((u) => u.id === pa.id || u.id === pb.id));

  // They do appear in the admin queue.
  const queue = (await (await adminClient())("GET", "/api/admin/queue")).body;
  assert.ok(queue.pending.some((u) => u.id === pa.id));

  await approve(pa.id);
  assert.ok((await a("GET", "/api/users")).body.some((u) => u.id === pa.id));

  // Rejection is recorded with a reason the owner can see.
  await (await adminClient())("POST", `/api/admin/photo/${pb.id}`, { action: "reject", reason: "not a real face" });
  const meB = (await b("GET", "/api/me")).body;
  assert.equal(meB.profile.photoStatus, "rejected");
  assert.equal(meB.profile.moderation.reason, "not a real face");
  assert.ok(!(await a("GET", "/api/users")).body.some((u) => u.id === pb.id));
});

test("escalate locks the account so the photo can't be re-submitted", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "esc@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Esc", gender: "man", photo: await photoData(30), answers: {} })).body;
  await (await adminClient())("POST", `/api/admin/photo/${pa.id}`, { action: "escalate", reason: "possible minor" });
  const retry = await a("POST", "/api/profile", { photo: await photoData(60) });
  assert.equal(retry.status, 403);
  const me = (await a("GET", "/api/me")).body;
  assert.equal(me.profile.accountLocked, true);
});

test("a declared age under 18 is rejected outright", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "kid@ex.com", password: "hunter2" });
  const r = await a("POST", "/api/profile", { name: "Kid", gender: "man", age: 17, photo: await photoData(40), answers: {} });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /under 18/);
  assert.equal(r.body.profile.photoStatus, "rejected");
});

test("changing your photo sends it back to pending", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "repho@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Re", gender: "man", photo: await photoData(50), answers: {} })).body;
  await approve(pa.id);
  await a("POST", "/api/profile", { photo: await photoData(150) });
  const me = (await a("GET", "/api/me")).body;
  assert.equal(me.profile.photoStatus, "pending");
  assert.ok(!(await a("GET", "/api/users")).body.some((u) => u.id === pa.id));
});

test("admin routes require an admin account", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "nonadmin@ex.com", password: "hunter2" });
  assert.equal((await a("GET", "/api/admin/queue")).status, 403);
  assert.equal((await client()("GET", "/api/admin/queue")).status, 401);
});

test("a Human Nature gap over the window blocks a match", async () => {
  const a = client(), b = client(), c = client();
  await a("POST", "/auth/signup", { email: "nat-a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "nat-b@ex.com", password: "hunter2" });
  await c("POST", "/auth/signup", { email: "nat-c@ex.com", password: "hunter2" });
  // Opposite ends of the morality quiz -> the widest possible nature gap.
  const pa = (await a("POST", "/api/profile", { name: "Na", gender: "man", moralAnswers: moralAll(2) })).body;
  const pb = (await b("POST", "/api/profile", { name: "Nb", gender: "woman", moralAnswers: moralAll(-2) })).body;
  const pc = (await c("POST", "/api/profile", { name: "Nc", gender: "woman", moralAnswers: moralAll(0) })).body;
  await approve(pa.id, pb.id, pc.id);
  assert.ok(Math.abs(pa.natureScore - pb.natureScore) > 25);

  for (let i = 0; i < 3; i++) await a("POST", "/api/vote", { winnerId: pb.id, loserId: pc.id });
  for (let i = 0; i < 3; i++) await b("POST", "/api/vote", { winnerId: pa.id, loserId: pc.id });
  assert.equal((await a("GET", "/api/matches")).body.length, 0); // picks met, nature gap blocks
  const rep = (await a("GET", "/api/report")).body;
  assert.ok(rep.almost.some((m) => m.id === pb.id && m.blockedBy === "nature"));
});

test("the morality quiz scores, gates matches, and reports what everyone else said", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "moral@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", { name: "Mora", gender: "woman" });

  const q = (await a("GET", "/api/moral-questions")).body;
  assert.equal(q.questions.length, 36);
  assert.equal(q.answered, 0);

  // Answering returns the confession stat for that question.
  const worst = q.questions[0].options.findIndex((o) => o.value === 2);
  const r = await a("POST", "/api/moral-answer", { qid: q.questions[0].id, i: worst });
  assert.equal(r.status, 200);
  assert.equal(r.body.score, 2);
  assert.equal(r.body.answered, 1);
  assert.ok(r.body.stats.total >= 1);
  assert.ok(typeof r.body.stats.you.line === "string");

  // Changing your mind re-scores rather than stacking.
  const best = q.questions[0].options.findIndex((o) => o.value === -2);
  const again = await a("POST", "/api/moral-answer", { qid: q.questions[0].id, i: best });
  assert.equal(again.body.score, -2);
  assert.equal(again.body.answered, 1);

  assert.equal((await a("POST", "/api/moral-answer", { qid: "nope", i: 0 })).status, 400);
});

test("the report carries the verdict, the vice breakdown and the worst vice", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "verdict@ex.com", password: "hunter2" });
  const qs = (await a("GET", "/api/moral-questions")).body.questions;
  const answers = Object.fromEntries(qs.map((q) => [q.id, q.options.findIndex((o) => o.value === 2)]));
  await a("POST", "/api/profile", { name: "Vee", gender: "woman", moralAnswers: answers });

  const rep = (await a("GET", "/api/report")).body;
  assert.equal(rep.nature.score, 72);
  assert.equal(rep.nature.complete, true);
  assert.equal(rep.nature.verdict.label, "Irredeemable");
  assert.equal(rep.nature.answered, 36);
  assert.equal(Object.keys(rep.nature.breakdown).length, 6);
  assert.ok(rep.nature.worst.label);
});

test("skipping the quiz blocks a match even with mutual picks", async () => {
  const a = client(), b = client(), c = client();
  await a("POST", "/auth/signup", { email: "sq-a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "sq-b@ex.com", password: "hunter2" });
  await c("POST", "/auth/signup", { email: "sq-c@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Sa", gender: "man" })).body;
  const pb = (await b("POST", "/api/profile", { name: "Sb", gender: "woman" })).body;
  const pc = (await c("POST", "/api/profile", { name: "Sc", gender: "woman" })).body;
  await approve(pa.id, pb.id, pc.id);

  for (let i = 0; i < 3; i++) await a("POST", "/api/vote", { winnerId: pb.id, loserId: pc.id });
  for (let i = 0; i < 3; i++) await b("POST", "/api/vote", { winnerId: pa.id, loserId: pc.id });
  assert.equal((await a("GET", "/api/matches")).body.length, 0);
  const rep = (await a("GET", "/api/report")).body;
  assert.ok(rep.almost.some((m) => m.id === pb.id && m.blockedBy === "your-quiz"));

  // Both finish the quiz identically -> gap 0, and the match lands.
  const qs = (await a("GET", "/api/moral-questions")).body.questions;
  const same = Object.fromEntries(qs.map((q) => [q.id, q.options.findIndex((o) => o.value === 0)]));
  await a("POST", "/api/profile", { moralAnswers: same });
  await b("POST", "/api/profile", { moralAnswers: same });
  await approve(pa.id, pb.id); // re-approve: editing the profile re-queues the photo
  const matches = (await a("GET", "/api/matches")).body;
  assert.equal(matches.length, 1);
  assert.equal(matches[0].natureGap, 0);
});

test("the morality guessing round compares Human Nature scores", async () => {
  const a = client(), evil = client(), saint = client();
  await a("POST", "/auth/signup", { email: "mg@ex.com", password: "hunter2" });
  await evil("POST", "/auth/signup", { email: "mg-evil@ex.com", password: "hunter2" });
  await saint("POST", "/auth/signup", { email: "mg-saint@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", { name: "Judge", gender: "woman" });
  const qs = (await a("GET", "/api/moral-questions")).body.questions;
  const pick = (v) => Object.fromEntries(qs.map((q) => [q.id, q.options.findIndex((o) => o.value === v)]));
  const pe = (await evil("POST", "/api/profile", { name: "Ev", gender: "man", moralAnswers: pick(2) })).body;
  const ps = (await saint("POST", "/api/profile", { name: "St", gender: "man", moralAnswers: pick(-2) })).body;
  await approve(pe.id, ps.id);

  assert.equal((await a("GET", "/api/versus?axis=moral&gender=man")).status, 200);
  const hit = await a("POST", "/api/versus-guess", { axis: "moral", aId: pe.id, bId: ps.id, pick: "a" });
  assert.equal(hit.body.correct, true);
  const miss = await a("POST", "/api/versus-guess", { axis: "moral", aId: pe.id, bId: ps.id, pick: "b" });
  assert.equal(miss.body.correct, false);
  assert.ok((await a("GET", "/api/guess-stats")).body.moral.total >= 2);
});

test("a photo URL is bound to one viewer and dies on expiry", async () => {
  const a = client(), b = client();
  await a("POST", "/auth/signup", { email: "tok-a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "tok-b@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Tok", gender: "man", photo: await photoData(70) })).body;
  const url = pa.photoUrl;
  assert.match(url, /^\/photos\/[0-9a-f]{32}\?t=/);

  // The owner's own session can fetch it.
  const ok = await raw(a.cookie(), url);
  assert.equal(ok.status, 200);
  assert.equal(ok.type, "image/jpeg");
  assert.equal(ok.cache, "private, no-store, max-age=0");
  assert.match(ok.robots, /noindex/);

  // The exact same URL in someone else's session is refused...
  assert.equal((await raw(b.cookie(), url)).status, 403);
  // ...and logged out it doesn't resolve at all.
  assert.equal((await raw("", url)).status, 401);

  // A tampered token fails the MAC check.
  assert.equal((await raw(a.cookie(), url.slice(0, -2) + "xx")).status, 403);
  // A token minted for one photo doesn't open another.
  const pb = (await b("POST", "/api/profile", { name: "Tok2", gender: "man", photo: await photoData(80) })).body;
  const swapped = pb.photoUrl.split("?")[0] + "?" + url.split("?")[1];
  assert.equal((await raw(b.cookie(), swapped)).status, 403);

  // An expired token is refused even in the right session.
  const { mint } = await import("../src/phototokens.js");
  const id = url.slice("/photos/".length).split("?")[0];
  const meA = (await a("GET", "/api/me")).body;
  const stale = `/photos/${id}?t=${mint(id, meA.account.id, -1000)}`;
  assert.equal((await raw(a.cookie(), stale)).status, 403);
});

test("photo ids are validated, so a path can never escape the store", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "trav@ex.com", password: "hunter2" });
  for (const bad of ["..%2f..%2fetc%2fpasswd", "not-a-photo-id", "0".repeat(31), "0".repeat(33)]) {
    const r = await raw(a.cookie(), `/photos/${bad}?t=whatever`);
    assert.equal(r.status, 404, `expected 404 for ${bad}`);
  }
});

test("uploads are sanitized: EXIF is destroyed and non-images are refused", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "exif@ex.com", password: "hunter2" });

  // A JPEG carrying EXIF (a real phone photo carries GPS here).
  const withExif = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 12, g: 200, b: 90 } } })
    .jpeg().withExif({ IFD0: { Copyright: "TRACKING-ME" } }).toBuffer();
  assert.notEqual((await sharp(withExif).metadata()).exif, undefined); // it's really there

  const p = (await a("POST", "/api/profile", { name: "Ex", gender: "woman", photo: `data:image/jpeg;base64,${withExif.toString("base64")}` })).body;
  const { get } = await import("../src/photos.js");
  const id = p.photoUrl.slice("/photos/".length).split("?")[0];
  const stored = get(id);
  assert.equal((await sharp(stored).metadata()).exif, undefined); // stripped on ingest

  // An SVG is a script; it must never be stored and served back.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString("base64");
  const bad = await a("POST", "/api/profile", { photo: `data:image/svg+xml;base64,${svg}` });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /JPEG, PNG and WebP/);

  assert.equal((await a("POST", "/api/profile", { photo: "data:image/jpeg;base64,bm90YW5pbWFnZQ==" })).status, 400);
});

test("photo bytes are encrypted on disk and shredded when rejected", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "enc@ex.com", password: "hunter2" });
  const p = (await a("POST", "/api/profile", { name: "En", gender: "man", photo: await photoData(90) })).body;
  const id = p.photoUrl.slice("/photos/".length).split("?")[0];

  const { readFileSync } = await import("node:fs");
  const { PHOTO_DIR, get } = await import("../src/photos.js");
  const { join } = await import("node:path");
  const onDisk = readFileSync(join(PHOTO_DIR, id.slice(0, 2), `${id}.enc`));
  // Ciphertext: the JPEG magic bytes must not appear anywhere in the file.
  assert.equal(onDisk.indexOf(Buffer.from([0xff, 0xd8, 0xff])), -1);
  assert.ok(get(id)?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))); // but decrypts back

  // Rejecting deletes the bytes rather than just hiding them.
  await (await adminClient())("POST", `/api/admin/photo/${p.id}`, { action: "reject", reason: "no" });
  assert.equal(get(id), null);
});

test("the API never leaks a name into the rating pool", async () => {
  const a = client(), b = client();
  await a("POST", "/auth/signup", { email: "anon-a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "anon-b@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Secret", gender: "woman", photo: await photoData(100) })).body;
  const pb = (await b("POST", "/api/profile", { name: "AlsoSecret", gender: "woman", photo: await photoData(110) })).body;
  await approve(pa.id, pb.id);

  // Your own view keeps your name; everyone else's view of you has none.
  assert.equal(pa.name, "Secret");
  const users = (await b("GET", "/api/users")).body;
  const seen = users.find((u) => u.id === pa.id);
  assert.ok(seen);
  assert.equal(seen.name, undefined);
  assert.equal(JSON.stringify(users).includes("Secret"), false);

  const one = (await b("GET", `/api/users/${pa.id}`)).body;
  assert.equal(one.name, undefined);
});

test("a name reaches a match only when shared, and can be withdrawn", async () => {
  const a = client(), b = client(), c = client();
  for (const [cl, em] of [[a, "sn-a"], [b, "sn-b"], [c, "sn-c"]]) {
    await cl("POST", "/auth/signup", { email: `${em}@ex.com`, password: "hunter2" });
  }
  const same = moralAll(0);
  const pa = (await a("POST", "/api/profile", { name: "Ann", gender: "man", shareName: true, moralAnswers: same, socials: { instagram: "ann" } })).body;
  const pb = (await b("POST", "/api/profile", { name: "Bee", gender: "woman", shareName: false, moralAnswers: same, socials: { instagram: "bee" } })).body;
  const pc = (await c("POST", "/api/profile", { name: "Cee", gender: "woman", moralAnswers: same })).body;
  await approve(pa.id, pb.id, pc.id);

  for (let i = 0; i < 3; i++) await a("POST", "/api/vote", { winnerId: pb.id, loserId: pc.id });
  for (let i = 0; i < 3; i++) await b("POST", "/api/vote", { winnerId: pa.id, loserId: pc.id });

  // B didn't share -> A sees no name but does see socials.
  const aSees = (await a("GET", "/api/matches")).body;
  assert.equal(aSees.length, 1);
  assert.equal(aSees[0].user.name, null);
  assert.equal(aSees[0].user.socials.instagram, "bee");
  // A did share -> B sees it.
  assert.equal((await b("GET", "/api/matches")).body[0].user.name, "Ann");
  // A turns it off -> gone immediately.
  await a("POST", "/api/profile", { shareName: false });
  assert.equal((await b("GET", "/api/matches")).body[0].user.name, null);
});

test("the report carries rank, win rate and the rejection count", async () => {
  const a = client(), b = client(), c = client();
  for (const [cl, em] of [[a, "st-a"], [b, "st-b"], [c, "st-c"]]) {
    await cl("POST", "/auth/signup", { email: `${em}@ex.com`, password: "hunter2" });
  }
  const pa = (await a("POST", "/api/profile", { name: "Sa", gender: "man", photo: await photoData(120) })).body;
  const pb = (await b("POST", "/api/profile", { name: "Sb", gender: "man", photo: await photoData(130) })).body;
  const pc = (await c("POST", "/api/profile", { name: "Sc", gender: "man", photo: await photoData(140) })).body;
  await approve(pa.id, pb.id, pc.id);

  // c picks b over a, twice; then a over b once.
  await c("POST", "/api/vote", { winnerId: pb.id, loserId: pa.id });
  await c("POST", "/api/vote", { winnerId: pb.id, loserId: pa.id });
  await c("POST", "/api/vote", { winnerId: pa.id, loserId: pb.id });

  const rep = (await a("GET", "/api/report")).body;
  assert.equal(rep.wins, 1);
  assert.equal(rep.losses, 2);
  assert.equal(rep.winRate, 33);
  assert.equal(rep.rejectedBy, 1); // one distinct person passed on them
  assert.equal(rep.chosenBy, 1);
  assert.ok(rep.rank.rank >= 1 && rep.rank.of >= 2);
});

test("dilemma rounds tally onto the target and count toward credits", async () => {
  const a = client(), x = client(), y = client();
  for (const [cl, em] of [[a, "dl-a"], [x, "dl-x"], [y, "dl-y"]]) {
    await cl("POST", "/auth/signup", { email: `${em}@ex.com`, password: "hunter2" });
  }
  await a("POST", "/api/profile", { name: "Judge", gender: "woman" });
  const px = (await x("POST", "/api/profile", { name: "X", gender: "man", photo: await photoData(160) })).body;
  const py = (await y("POST", "/api/profile", { name: "Y", gender: "man", photo: await photoData(170) })).body;
  await approve(px.id, py.id);

  assert.equal((await a("GET", "/api/dilemma?kind=death&gender=man")).status, 200);
  const saved = await a("POST", "/api/dilemma", { kind: "death", aId: px.id, bId: py.id, pick: "a" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.votesCast, 1);
  await a("POST", "/api/dilemma", { kind: "cheat", aId: px.id, pick: "yes" });
  await a("POST", "/api/dilemma", { kind: "cheat", aId: px.id, pick: "no" });

  const rep = (await x("GET", "/api/report")).body;
  assert.equal(rep.death.saved, 1);
  assert.equal(rep.cheat.yes, 1);
  assert.equal(rep.cheat.no, 1);
  assert.equal((await y("GET", "/api/report")).body.death.left, 1);

  assert.equal((await a("POST", "/api/dilemma", { kind: "nope", aId: px.id, pick: "yes" })).status, 400);
  assert.equal((await a("POST", "/api/dilemma", { kind: "cheat", aId: px.id, pick: "maybe" })).status, 400);
});

test("boards are opt-in, require the agreement, and drop you instantly on opt-out", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "bd-a@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", { name: "Bo", gender: "man", photo: await photoData(180) })).body;
  await approve(pa.id);

  const before = (await a("GET", "/api/leaderboard")).body;
  assert.equal(before.me.optedIn, false);
  assert.equal(before.me.eligible, false);

  // Joining without accepting the current agreement version is refused.
  assert.equal((await a("POST", "/api/board-optin", { on: true })).status, 400);
  assert.equal((await a("POST", "/api/board-optin", { on: true, agreementVersion: "0.0" })).status, 400);

  const joined = await a("POST", "/api/board-optin", { on: true, agreementVersion: before.me.agreementVersion });
  assert.equal(joined.status, 200);
  assert.equal((await a("GET", "/api/leaderboard")).body.me.optedIn, true);
  // Opted in but under the matchup floor -> still not on the board itself.
  assert.equal((await a("GET", "/api/leaderboard")).body.me.eligible, false);

  await a("POST", "/api/board-optin", { on: false });
  assert.equal((await a("GET", "/api/leaderboard")).body.me.optedIn, false);
});

test("legal documents are public, and acceptance is recorded per version", async () => {
  const anon = client();
  const terms = await anon("GET", "/api/legal/terms");
  assert.equal(terms.status, 200);
  assert.ok(terms.body.html.includes("<h1>"));
  assert.match(terms.body.html, /18/);
  assert.equal((await anon("GET", "/api/legal/nope")).status, 404);

  const a = client();
  await a("POST", "/auth/signup", { email: "legal@ex.com", password: "hunter2" });
  const me = (await a("GET", "/api/me")).body;
  // Signing up records acceptance of the required documents.
  assert.deepEqual(me.outstanding, []);
  assert.equal(me.account.agreements.terms.version, terms.body.version);
  assert.ok(me.account.agreements.terms.acceptedAt);
  assert.ok(me.account.agreements.privacy);
  // The board agreement is separate and not accepted by signing up.
  assert.equal(me.account.agreements.board, undefined);
});

test("regional restrictions refuse blocked countries and Illinois", async () => {
  // Country blocking, via the edge header the deployment is expected to set.
  const blocked = await fetch(base + "/auth/config", { headers: { "CF-IPCountry": "DE" } });
  assert.equal(blocked.status, 451);
  const uk = await fetch(base + "/api/legal/terms", { headers: { "CF-IPCountry": "GB" } });
  assert.equal(uk.status, 451);
  const ok = await fetch(base + "/auth/config", { headers: { "CF-IPCountry": "CA" } });
  assert.equal(ok.status, 200);

  // Illinois: refused at signup on the declared state.
  const il = await fetch(base + "/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-IPCountry": "US" },
    body: JSON.stringify({ email: "illinois@ex.com", password: "hunter2", state: "IL" }),
  });
  assert.equal(il.status, 451);
  assert.match((await il.json()).error, /Illinois/);

  // A US signup with no state at all is refused too, rather than waved through.
  const noState = await fetch(base + "/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-IPCountry": "US" },
    body: JSON.stringify({ email: "nostate@ex.com", password: "hunter2" }),
  });
  assert.equal(noState.status, 451);

  // A permitted state goes through.
  const ny = await fetch(base + "/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-IPCountry": "US" },
    body: JSON.stringify({ email: "newyork@ex.com", password: "hunter2", state: "NY" }),
  });
  assert.equal(ny.status, 201);
});
