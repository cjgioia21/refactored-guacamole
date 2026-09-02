import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

// Use isolated data files so tests don't touch real data.
process.env.NODE_ENV = "test";

const dataDir = new URL("../data/", import.meta.url);
const files = ["accounts.json", ".secret", "users.json"].map((f) => new URL(f, dataDir));
function clean() { for (const f of files) { try { rmSync(f); } catch {} } }

before(clean);
after(clean);

const auth = await import("../src/auth.js");

test("signup validates email and password", () => {
  assert.equal(auth.signup("bad", "secret1").error, "invalid email");
  assert.equal(auth.signup("a@b.co", "123").error, "password too short (min 6)");
});

test("signup then login round-trips; wrong password fails", () => {
  const s = auth.signup("user@example.com", "hunter2");
  assert.ok(s.account && !s.error);
  assert.equal(auth.signup("user@example.com", "hunter2").error, "email already registered");
  assert.ok(auth.login("user@example.com", "hunter2").account);
  assert.equal(auth.login("user@example.com", "wrong").error, "invalid credentials");
});

test("session cookie signs and verifies; tampering is rejected", () => {
  const s = auth.signup("sess@example.com", "hunter2");
  let cookie;
  const res = { setHeader: (_k, v) => (cookie = v) };
  auth.issueSession(res, s.account.id);
  const raw = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  const req = { headers: { cookie: `sm_session=${encodeURIComponent(raw)}` } };
  assert.equal(auth.currentAccount(req).id, s.account.id);
  const bad = { headers: { cookie: `sm_session=${encodeURIComponent(raw + "x")}` } };
  assert.equal(auth.currentAccount(bad), null);
});

test("linkProfile attaches a profile id to the account", () => {
  const s = auth.signup("link@example.com", "hunter2");
  auth.linkProfile(s.account.id, "profile-123");
  assert.equal(auth.accountById(s.account.id).profileId, "profile-123");
});

test("upsertGoogle creates then reuses by googleId", () => {
  const a = auth.upsertGoogle({ googleId: "g-1", email: "g@example.com" });
  const b = auth.upsertGoogle({ googleId: "g-1", email: "g@example.com" });
  assert.equal(a.id, b.id);
  assert.equal(a.googleId, "g-1");
});
