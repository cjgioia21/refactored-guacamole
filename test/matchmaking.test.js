import { test } from "node:test";
import assert from "node:assert/strict";
import { compatibility, findMatches, pairAll, WEIGHTS } from "../src/matchmaking.js";

const alice = {
  id: "a", subjects: ["calculus", "physics"], goals: ["exam prep"],
  languages: ["english"], level: "intermediate", style: "pomodoro",
  availability: { mon: ["evening"], wed: ["evening"] },
};
const bob = {
  id: "b", subjects: ["calculus", "chemistry"], goals: ["exam prep"],
  languages: ["english"], level: "intermediate", style: "pomodoro",
  availability: { mon: ["evening"], wed: ["morning"] },
};
const carol = {
  id: "c", subjects: ["history"], goals: ["accountability"],
  languages: ["french"], level: "expert", style: "silent",
  availability: { sat: ["night"] },
};

test("identical profiles score 100", () => {
  const self = { ...alice, id: "z" };
  assert.equal(compatibility(alice, self).score, 100);
});

test("score is 0..100 and breakdown weights sum to total", () => {
  const r = compatibility(alice, bob);
  assert.ok(r.score >= 0 && r.score <= 100);
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(totalWeight, 100);
});

test("shared subjects are detected", () => {
  const r = compatibility(alice, bob);
  assert.deepEqual(r.sharedSubjects, ["calculus"]);
});

test("more compatible partner outranks less compatible", () => {
  assert.ok(compatibility(alice, bob).score > compatibility(alice, carol).score);
});

test("empty profiles do not throw and score low", () => {
  const empty = { id: "e" };
  const r = compatibility(alice, empty);
  assert.ok(r.score >= 0 && r.score < 30);
});

test("findMatches excludes self and sorts descending", () => {
  const matches = findMatches(alice, [alice, bob, carol]);
  assert.ok(!matches.some((m) => m.user.id === "a"));
  assert.equal(matches[0].user.id, "b");
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1].score >= matches[i].score);
  }
});

test("pairAll pairs best matches and leaves odd one unpaired", () => {
  const { pairs, unpaired } = pairAll([alice, bob, carol]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.id === "a" || pairs[0].b.id === "a", true);
  assert.equal(unpaired[0].id, "c");
});
