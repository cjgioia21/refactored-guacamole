import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

process.env.NODE_ENV = "test";
process.env.ADMIN_EMAILS = "admin@ex.com";
const dataDir = new URL("../data/", import.meta.url);
const files = ["accounts.json", ".secret", ".photokey", ".photosecret", "users.json", "moral-tally.json", "reports.json"].map((f) => new URL(f, dataDir));
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

test("reporting a photo works without an account and hides urgent cases at once", async () => {
  const owner = client();
  await owner("POST", "/auth/signup", { email: "rep-owner@ex.com", password: "hunter2" });
  const p = (await owner("POST", "/api/profile", { name: "Rep", gender: "man", photo: await photoData(190) })).body;
  await approve(p.id);
  assert.ok((await owner("GET", "/api/users")).body.some((u) => u.id === p.id));

  const reasons = (await client()("GET", "/api/report-reasons")).body.reasons;
  assert.ok(reasons.some((r) => r.key === "minor" && r.urgent && r.response));
  assert.ok(reasons.some((r) => r.key === "not_them" && r.urgent));

  // A signed-out visitor can report — the Terms say you shouldn't need an
  // account to report your own face, so the API must allow it.
  const anon = client();
  const filed = await anon("POST", "/api/report", { targetId: p.id, reason: "minor", detail: "looks about 15" });
  assert.equal(filed.status, 201);
  assert.equal(filed.body.urgent, true);
  assert.equal(filed.body.hidden, true);

  // The photo is out of circulation before any human has looked at it.
  const me = (await owner("GET", "/api/me")).body;
  assert.equal(me.profile.photoStatus, "pending");
  assert.ok(!(await owner("GET", "/api/users")).body.some((u) => u.id === p.id));

  assert.equal((await anon("POST", "/api/report", { targetId: p.id, reason: "nonsense" })).status, 400);
});

test("a non-urgent report is queued but does not take the photo down", async () => {
  const owner = client();
  await owner("POST", "/auth/signup", { email: "rep2@ex.com", password: "hunter2" });
  const p = (await owner("POST", "/api/profile", { name: "Rep2", gender: "man", photo: await photoData(200) })).body;
  await approve(p.id);
  const r = await client()("POST", "/api/report", { targetId: p.id, reason: "other", detail: "just odd" });
  assert.equal(r.status, 201);
  assert.equal(r.body.urgent, false);
  assert.equal(r.body.hidden, false);
  assert.equal((await owner("GET", "/api/me")).body.profile.photoStatus, "approved");
});

test("the admin report queue puts urgent reports first and tracks the response window", async () => {
  const admin = await adminClient();
  const q = (await admin("GET", "/api/admin/reports")).body;
  assert.ok(q.open.length >= 2);
  assert.equal(q.open[0].urgent, true); // urgent sorts ahead of the rest
  assert.equal(typeof q.oldestOpenHours, "number");

  const first = q.open[0];
  const done = await admin("POST", `/api/admin/reports/${first.id}`, { status: "actioned", resolution: "photo removed" });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "actioned");
  assert.ok(done.body.resolvedAt);
  assert.equal((await admin("GET", "/api/admin/reports")).body.open.some((r) => r.id === first.id), false);

  assert.equal((await admin("POST", `/api/admin/reports/${first.id}`, { status: "nonsense" })).status, 400);
  // Reports are admin-only.
  assert.equal((await client()("GET", "/api/admin/reports")).status, 401);
});

test("verification state is reported, and an admin can verify by hand", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "ver@ex.com", password: "hunter2" });
  const p = (await a("POST", "/api/profile", { name: "Ver", gender: "man", photo: await photoData(210) })).body;

  const before = (await a("GET", "/api/verify")).body;
  assert.equal(before.verified, false);
  // No provider configured in tests, so starting a flow fails honestly rather
  // than pretending to verify anyone.
  assert.equal((await a("POST", "/api/verify/start", {})).status, 503);

  const admin = await adminClient();
  const marked = await admin("POST", `/api/admin/verify/${p.id}`, { verified: true });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.verified, true);
  assert.equal(marked.body.verificationMethod, "manual");
  assert.equal((await a("GET", "/api/verify")).body.verified, true);
  assert.equal((await a("GET", "/api/me")).body.profile.verified, true);

  await admin("POST", `/api/admin/verify/${p.id}`, { verified: false });
  assert.equal((await a("GET", "/api/verify")).body.verified, false);
});

test("a voter can sign up and vote with no photo, and is never rated", async () => {
  // Two participants to be rated, and one voter who has no photo at all.
  const p1 = client(), p2 = client(), voter = client();
  for (const [cl, em] of [[p1, "vp-1"], [p2, "vp-2"], [voter, "vp-voter"]]) {
    await cl("POST", "/auth/signup", { email: `${em}@ex.com`, password: "hunter2" });
  }
  const a = (await p1("POST", "/api/profile", { name: "P1", gender: "woman", photo: await photoData(220) })).body;
  const b = (await p2("POST", "/api/profile", { name: "P2", gender: "woman", photo: await photoData(230) })).body;
  await approve(a.id, b.id);

  // The voter's profile carries no photo and needs no review.
  const v = (await voter("POST", "/api/profile", { name: "Vee", gender: "man" })).body;
  assert.equal(v.hasPhoto, false);
  assert.equal(v.isParticipant, false);

  // They can still vote, which is the whole point of making them sign in.
  const pair = await voter("GET", "/api/matchup?gender=woman");
  assert.equal(pair.status, 200);
  const vote = await voter("POST", "/api/vote", { winnerId: a.id, loserId: b.id });
  assert.equal(vote.status, 200);
  assert.equal(vote.body.votesCast, 1);

  // And they are never in anyone's matchup pool themselves.
  assert.equal((await p1("GET", "/api/users")).body.some((u) => u.id === v.id), false);
});

test("the Top 10 ranks by win rate per gender, with no opt-in anywhere", async () => {
  // Any signed-in profile can read the board — this one is a plain voter.
  const c = client();
  await c("POST", "/auth/signup", { email: "board-reader@ex.com", password: "hunter2" });
  await c("POST", "/api/profile", { name: "Reader", gender: "man" });
  const board = (await c("GET", "/api/leaderboard")).body;
  assert.ok(Array.isArray(board.boards));
  assert.equal(board.minMatchups, 50);
  // Nothing in the payload offers a way in or out.
  const flat = JSON.stringify(board);
  for (const gone of ["optedIn", "agreementVersion", "bottom", "eligible"]) {
    assert.equal(flat.includes(gone), false, `leaderboard should not mention ${gone}`);
  }
  assert.equal((await c("POST", "/api/board-optin", { on: true })).status, 404);
});

test("a ranked participant sees their own standing with a rank and a percentile", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "stand@ex.com", password: "hunter2" });
  const p = (await a("POST", "/api/profile", { name: "St", gender: "man", photo: await photoData(240) })).body;
  await approve(p.id);

  const before = (await a("GET", "/api/leaderboard")).body;
  assert.equal(before.isParticipant, true);
  assert.equal(before.you.ranked, false); // no matchups yet
  assert.equal(before.you.toGo, 50);

  // The report carries the same standing, so home can show it without a second call.
  assert.ok((await a("GET", "/api/report")).body.standing);
});

test("the report exposes the four mirrors and nothing about matching", async () => {
  const a = client();
  await a("POST", "/auth/signup", { email: "mirror@ex.com", password: "hunter2" });
  await a("POST", "/api/profile", { name: "Mi", gender: "woman", photo: await photoData(250) });
  const r = (await a("GET", "/api/report")).body;

  assert.ok(r.compatibilityGap, "compatibility gap");
  assert.ok(Array.isArray(r.selfVsCrowd) && r.selfVsCrowd.length > 0, "self vs crowd");
  assert.ok(r.reciprocity, "reciprocity");
  assert.ok(r.moralityVsLooks && Array.isArray(r.moralityVsLooks.points), "scatter");
  for (const gone of ["matches", "crushes", "almost", "suggestions"]) {
    assert.equal(r[gone], undefined, `report should not carry ${gone}`);
  }
  // The dating endpoints are gone from the server entirely.
  assert.equal((await a("GET", "/api/matches")).status, 404);
});

test("socials are attachable, shown on the Top 10, and never in the rating pool", async () => {
  const a = client(), b = client();
  await a("POST", "/auth/signup", { email: "soc-a@ex.com", password: "hunter2" });
  await b("POST", "/auth/signup", { email: "soc-b@ex.com", password: "hunter2" });
  const pa = (await a("POST", "/api/profile", {
    name: "Soc", gender: "woman", photo: await photoData(260),
    socials: { instagram: "soc_handle", tiktok: "soc_tok" },
  })).body;
  await approve(pa.id);

  // Rating someone must never reveal a handle — it would change the vote.
  const users = (await b("GET", "/api/users")).body;
  assert.equal(JSON.stringify(users).includes("soc_handle"), false);
  const one = (await b("GET", `/api/users/${pa.id}`)).body;
  assert.equal(one.socials, undefined);
});

test("a reviewer can request ID, which blocks approval until it arrives", async () => {
  const a = client();
  const admin = await adminClient();
  await a("POST", "/auth/signup", { email: "idreq@ex.com", password: "hunter2" });
  const p = (await a("POST", "/api/profile", { name: "Young", gender: "man", photo: await photoData(270) })).body;

  const asked = await admin("POST", `/api/admin/photo/${p.id}`, { action: "request-id" });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.idRequested, true);
  assert.equal(asked.body.photoStatus, "pending");

  // The person is told, and the upload card is unlocked for them.
  assert.equal((await a("GET", "/api/verify")).body.idRequested, true);
  assert.equal((await a("GET", "/api/me")).body.profile.idRequested, true);

  // Approving before the ID arrives is refused rather than silently undoing it.
  const early = await admin("POST", `/api/admin/photo/${p.id}`, { action: "approve" });
  assert.equal(early.status, 409);
  assert.match(early.body.error || early.body.profile?.moderation?.reason || "", /waiting on their ID|age check/);

  // They send it; the admin can see it and nobody else can.
  await a("POST", "/api/profile", { idDocument: await photoData(280) });
  assert.equal((await admin("GET", "/api/admin/queue")).body.pending.find((u) => u.id === p.id).hasId, true);
  assert.equal((await raw(a.cookie(), `/api/admin/id/${p.id}`)).status, 403);
  assert.equal((await raw((await adminClient()).cookie(), `/api/admin/id/${p.id}`)).status, 200);

  // Approving now verifies them and shreds the document.
  const ok = await admin("POST", `/api/admin/photo/${p.id}`, { action: "approve" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.photoStatus, "approved");
  assert.equal(ok.body.verified, true);
  assert.equal(ok.body.verificationMethod, "manual-id");
  assert.equal(ok.body.hasId, false);
  assert.equal((await raw((await adminClient()).cookie(), `/api/admin/id/${p.id}`)).status, 404);
});

test("a voter is not held to the photo confirmations they were never shown", async () => {
  const c = client();
  await c("POST", "/auth/signup", { email: "noconfirm@ex.com", password: "hunter2" });
  // No photo, and confirmedAdult false because the confirmations card is hidden
  // for voters. This must still succeed — otherwise voting is locked behind a
  // gate that only exists for people uploading a face.
  const r = await c("POST", "/api/profile", { name: "NoC", gender: "man", confirmedAdult: false });
  assert.equal(r.status, 201);
  assert.equal(r.body.hasPhoto, false);
  assert.equal(r.body.isParticipant, false);

  // The same submission WITH a photo is still refused.
  const withPhoto = await c("POST", "/api/profile", { photo: await photoData(290), confirmedAdult: false });
  assert.equal(withPhoto.status, 422);
  assert.match(withPhoto.body.error, /18 or older/);
});
