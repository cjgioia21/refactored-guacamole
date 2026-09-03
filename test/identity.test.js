import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

// These have to be set before the modules load: identity.js reads the flag at
// module scope, and paths.js resolves DATA_DIR the same way. Using a scratch
// directory keeps this file's writes away from the other suites.
const DIR = new URL("../data/.identity-test/", import.meta.url).pathname;
process.env.NODE_ENV = "test";
process.env.DATA_DIR = DIR;
process.env.REQUIRE_ID_VERIFICATION = "1";

const clean = () => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} };
before(clean);
after(clean);

const identity = await import("../src/identity.js");
const store = await import("../src/store.js");

test("with verification required, an unverified profile can never be approved", () => {
  const u = store.create({ name: "Unverified", gender: "man", age: 30 });
  assert.equal(u.photoStatus, "pending");
  assert.equal(identity.mayGoLive(u), false);
  assert.match(identity.blockedReason(u), /verification/);

  // An admin trying to approve is refused — verification gates approval rather
  // than replacing it, so a human can't publish an unverified photo by mistake.
  const after = store.moderatePhoto(u.id, "approve", null, "admin@example.com");
  assert.equal(after.photoStatus, "pending");
  assert.match(after.moderation.reason, /verification/);
  assert.equal(store.visible().some((x) => x.id === u.id), false);
});

test("once verified, approval works and only a pass/fail record is kept", () => {
  const u = store.create({ name: "Verified", gender: "woman", age: 24 });
  store.setVerified(u.id, identity.verificationRecord({ method: "manual", reference: "admin:me@example.com" }));

  const rec = store.get(u.id).identity;
  assert.equal(rec.verified, true);
  assert.equal(rec.method, "manual");
  assert.ok(rec.verifiedAt);
  // The whole point: no document, no number, no name, no date of birth.
  assert.deepEqual(Object.keys(rec).sort(), ["method", "reference", "verified", "verifiedAt"]);

  assert.equal(identity.mayGoLive(store.get(u.id)), true);
  const after = store.moderatePhoto(u.id, "approve", null, "admin@example.com");
  assert.equal(after.photoStatus, "approved");
});

test("no provider is configured by default, and it refuses rather than pretending", async () => {
  assert.equal(identity.configured(), false);
  await assert.rejects(() => identity.start({}), identity.VerificationError);
  assert.deepEqual(await identity.resolve("anything"), { status: "unsupported", verified: false, method: "none" });
});
