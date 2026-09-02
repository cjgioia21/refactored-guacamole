import { test } from "node:test";
import assert from "node:assert/strict";
import { profileFromAnswers, QUESTIONS, AXES } from "../src/questions.js";
import { similarity, emptyAcc } from "../src/vectors.js";
import {
  updateElo, recordVote, percentile, matchScore, findMatches, guessOutcome,
  report, typeSummary, attractedGenders, likes, mutualMatches, pickRate,
  attractivenessBand, guessConsensus, fansReport, tasteReport, GAMES, TASTES, BASE_ELO, REVEAL_MIN,
} from "../src/engine.js";

function mkUser(id, answers, extra = {}) {
  return {
    id, name: id, traits: profileFromAnswers(answers), elo: BASE_ELO,
    matchups: 0, votesCast: 0, credits: 0, type: emptyAcc(), admirers: emptyAcc(),
    age: 28, gender: "woman", orientation: "straight", mentalHealth: [],
    guessesReceived: {}, fans: { n: 0, mh: {}, gender: {}, ageSum: 0, ageN: 0 }, ...extra,
  };
}
const pick = (q, target) =>
  q.options.reduce((best, o, i) =>
    Math.abs(o.value - target) < Math.abs(q.options[best].value - target) ? i : best, 0);
const answersAll = (target) => Object.fromEntries(QUESTIONS.map((q) => [q.id, pick(q, target)]));

test("profileFromAnswers produces every axis in [-1,1]", () => {
  const v = profileFromAnswers(answersAll(1));
  for (const axis of Object.keys(AXES)) assert.ok(v[axis] >= -1 && v[axis] <= 1);
});

test("empty answers give a zero vector", () => {
  assert.ok(Object.values(profileFromAnswers({})).every((x) => x === 0));
});

test("tiered bodycount question flattens to fine options and still scores", () => {
  const bc1 = QUESTIONS.find((q) => q.id === "bc1");
  assert.equal(bc1.type, "tiered");
  // tierGroups index into the flat options list without overlap or gaps
  let expected = 0;
  for (const g of bc1.tierGroups) { assert.equal(g.from, expected); expected += g.count; }
  assert.equal(expected, bc1.options.length);
  // picking the highest fine option maxes the bodycount axis
  const top = bc1.options.length - 1;
  const v = profileFromAnswers({ bc1: top });
  assert.equal(v.bodycount, bc1.options[top].value);
  assert.ok(v.bodycount > 0.9);
});

test("updateElo raises winner, lowers loser, conserves points", () => {
  const { winner, loser } = updateElo(1200, 1200);
  assert.ok(winner > 1200 && loser < 1200);
  assert.ok(Math.abs(winner + loser - 2400) < 1e-9);
});

test("recordVote updates elo, counts and learned profiles", () => {
  const voter = mkUser("v", answersAll(1), { gender: "man", age: 30 });
  const win = mkUser("w", answersAll(1), { gender: "woman", age: 34, mentalHealth: ["anxiety"] });
  const lose = mkUser("l", answersAll(-1), { gender: "woman", age: 20 });
  recordVote(voter, win, lose);
  assert.ok(win.elo > lose.elo);
  assert.equal(win.matchups, 1);
  assert.equal(voter.votesCast, 1);
  assert.equal(voter.type.gender.woman, 1); // learned gender preference
  assert.ok(voter.type.ageLean > 0); // chose someone older -> older lean
  assert.equal(voter.type.mh.anxiety, 1); // learned MH openness
  assert.equal(win.admirers.n, 1);
});

test("attractedGenders resolves orientation + gender", () => {
  assert.deepEqual(attractedGenders("straight", "man"), ["woman"]);
  assert.deepEqual(attractedGenders("straight", "woman"), ["man"]);
  assert.deepEqual(attractedGenders("lesbian", "woman"), ["woman"]);
  assert.deepEqual(attractedGenders("gay", "man"), ["man"]);
  assert.equal(attractedGenders("bi", "man").length, 3);
});

test("similarity: identical > opposite", () => {
  const same = profileFromAnswers(answersAll(1));
  const opp = profileFromAnswers(answersAll(-1));
  assert.ok(similarity(same, same) > similarity(same, opp));
});

test("percentile ranks higher elo above lower", () => {
  const pop = [mkUser("a"), mkUser("b"), mkUser("c")].map((u, i) => ({ ...u, elo: 1000 + i * 100, matchups: 5 }));
  assert.ok(percentile(pop[2], pop) > percentile(pop[0], pop));
});

test("matchScore is symmetric, bounded, and orientation-gated", () => {
  const a = mkUser("a", answersAll(0.5), { gender: "man", orientation: "straight" });
  const b = mkUser("b", answersAll(0.4), { gender: "woman", orientation: "straight" });
  const c = mkUser("c", answersAll(0.4), { gender: "man", orientation: "straight" });
  const pop = [a, b, c];
  const ab = matchScore(a, b, pop);
  assert.equal(ab.score, matchScore(b, a, pop).score);
  assert.ok(ab.score >= 0 && ab.score <= 100);
  // straight man ↔ straight man: near-zero mutual attraction
  assert.ok(matchScore(a, c, pop).score < ab.score);
});

test("findMatches excludes self and sorts descending", () => {
  const pop = [
    mkUser("a", answersAll(1), { gender: "man", orientation: "straight" }),
    mkUser("b", answersAll(0.9), { gender: "woman", orientation: "straight" }),
    mkUser("c", answersAll(-1), { gender: "woman", orientation: "straight" }),
  ];
  const m = findMatches(pop[0], pop);
  assert.ok(!m.some((x) => x.user.id === "a"));
  for (let i = 1; i < m.length; i++) assert.ok(m[i - 1].score >= m[i].score);
});

test("guessOutcome scores trait, age, gender and mental-health", () => {
  const t = mkUser("t", answersAll(1), { age: 40, gender: "woman", mentalHealth: ["bipolar"] });
  assert.equal(guessOutcome(t, "pol", "high").correct, true);
  assert.equal(guessOutcome(t, "age", "30+").correct, true);
  assert.equal(guessOutcome(t, "gender", "woman").correct, true);
  assert.equal(guessOutcome(t, "mh", "yes").correct, true);
  assert.equal(guessOutcome(t, "mh", "no").correct, false);
});

test("typeSummary reflects learned preferences", () => {
  const voter = mkUser("v", answersAll(0), { gender: "man", age: 30 });
  const older = mkUser("o", answersAll(1), { gender: "woman", age: 40, mentalHealth: ["anxiety"] });
  for (let i = 0; i < 6; i++) recordVote(voter, older, mkUser("x" + i, answersAll(-1), { gender: "woman", age: 22 }));
  const s = typeSummary(voter);
  assert.match(s.text, /women/);
  assert.match(s.text, /older/);
});

test("likes reflects rating someone over others; pickRate is a fraction", () => {
  const a = mkUser("a"), b = mkUser("b"), c = mkUser("c");
  recordVote(a, b, c); // a picks b over c
  assert.equal(likes(a, "b"), true);
  assert.equal(likes(a, "c"), false);
  assert.equal(pickRate(a, "b"), 1);
});

test("mutualMatches requires both to rate each other over others", () => {
  const a = mkUser("a"), b = mkUser("b"), c = mkUser("c");
  recordVote(a, b, c); // a likes b (not yet mutual)
  assert.equal(mutualMatches(a, [a, b, c]).length, 0);
  recordVote(b, a, c); // now b likes a -> mutual
  const m = mutualMatches(a, [a, b, c]);
  assert.equal(m.length, 1);
  assert.equal(m[0].user.id, "b");
  assert.ok(m[0].youPickRate > 0 && m[0].theyPickRate > 0);
});

test("attractivenessBand narrows with more matchups", () => {
  const pop = [mkUser("a"), mkUser("b"), mkUser("c")].map((u, i) => ({ ...u, elo: 1000 + i * 200, matchups: 5 }));
  const few = { ...pop[1], matchups: 1 };
  const many = { ...pop[1], matchups: 400 };
  const bandFew = attractivenessBand(few, pop);
  const bandMany = attractivenessBand(many, pop);
  assert.ok(bandFew.high - bandFew.low > bandMany.high - bandMany.low);
  assert.ok(bandFew.low >= 0 && bandFew.high <= 100);
});

test("recordVote aggregates fan demographics; fansReport surfaces overrepresentation", () => {
  const star = mkUser("star", answersAll(0.5), { gender: "man" });
  const fanA = mkUser("f1", answersAll(0.5), { mentalHealth: ["anxiety"] });
  const fanB = mkUser("f2", answersAll(0.5), { mentalHealth: ["anxiety"] });
  const plain = mkUser("p", answersAll(-0.5), { mentalHealth: [] });
  recordVote(fanA, star, plain);
  recordVote(fanB, star, plain);
  const rep = fansReport(star, [star, fanA, fanB, plain]);
  assert.equal(rep.fans, 2);
  assert.equal(rep.mentalHealth[0].flag, "anxiety");
  assert.ok(rep.mentalHealth[0].pct === 100);
});

test("tasteReport gates cards by votesCast and reports pole + slider position", () => {
  const voter = mkUser("v", answersAll(0), { gender: "man" });
  // voter repeatedly picks right-leaning women -> politics taste = right, gender women
  const win = mkUser("w", answersAll(0.8), { gender: "woman" });
  const pol = TASTES.find((t) => t.key === "politics");
  const t0 = tasteReport(voter, [voter, win]).find((t) => t.key === "politics");
  assert.equal(t0.unlocked, false); // no votes yet
  assert.equal(t0.votesToGo, pol.unlockAt);
  for (let i = 0; i < pol.unlockAt; i++) recordVote(voter, win, mkUser("l" + i, answersAll(-0.8), { gender: "woman" }));
  const t1 = tasteReport(voter, [voter, win]).find((t) => t.key === "politics");
  assert.equal(t1.unlocked, true);
  assert.equal(t1.pole, "right-leaning"); // picked right-leaning
  assert.equal(t1.gender, "women");
  assert.ok(t1.position >= 50 && t1.position <= 100); // knob on the high side
});

test("guessConsensus needs a minimum before it is ready", () => {
  const g = GAMES.find((x) => x.key === "politics");
  const u = mkUser("u", answersAll(0));
  u.guessesReceived[g.axis] = { low: 1, high: 1 };
  assert.equal(guessConsensus(u, g).ready, false);
  u.guessesReceived[g.axis] = { low: 1, high: REVEAL_MIN + 4 };
  const c = guessConsensus(u, g);
  assert.equal(c.ready, true);
  assert.equal(c.pole, g.poles[1]); // majority "high"
  assert.ok(c.pct >= 50);
});

test("report exposes percentile, yourType, mutual matches and crushes", () => {
  const a = mkUser("a", answersAll(0.6), { gender: "man" });
  const b = mkUser("b", answersAll(0.5), { gender: "woman" });
  const c = mkUser("c", answersAll(-0.6), { gender: "woman" });
  const pop = [a, b, c];
  recordVote(a, b, c); // a likes b, not mutual yet
  let r = report(a, pop);
  assert.equal(r.matches.length, 0);
  assert.equal(r.crushes, 1); // liked b, not matched back
  recordVote(b, a, c); // mutual now
  r = report(a, pop);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].id, "b");
  assert.ok(Array.isArray(r.likedBy) && typeof r.yourType.text === "string");
  assert.ok(r.attractivenessPercentile >= 0 && r.attractivenessPercentile <= 100);
});
