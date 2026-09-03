import { test } from "node:test";
import assert from "node:assert/strict";
import { profileFromAnswers, QUESTIONS, AXES } from "../src/questions.js";
import { MORAL_QUESTIONS, moralScore, moralAnswered, moralVerdict, moralBreakdown, worstVice, MORAL_MIN_ANSWERED } from "../src/morality.js";
import { similarity, emptyAcc } from "../src/vectors.js";
import {
  updateElo, recordVote, percentile, matchScore, findMatches, guessOutcome,
  report, typeSummary, attractedGenders, likes, mutualMatches, pickRate,
  attractivenessBand, guessConsensus, fansReport, tasteReport, GAMES, TASTES, BASE_ELO, REVEAL_MIN,
  canMatch, matchGates, nearMatches, NATURE_WINDOW, MIN_MUTUAL_PICKS, MORAL_MIN, quizDone, axisValue,
  winRate, rankOf, rejectedBy, chosenBy, predictionDelta, deathReport, cheatReport,
  leaderboard, boardEligible, BOARD_MIN_MATCHUPS,
} from "../src/engine.js";

// Answer every morality question at the same signed value: -2 (saint) .. +2.
const moralAll = (value) =>
  Object.fromEntries(MORAL_QUESTIONS.map((q) => [q.id, q.options.findIndex((o) => o.value === value)]));

function mkUser(id, answers, extra = {}) {
  const moral = extra.moralAnswers ?? moralAll(0);
  return {
    id, name: id, shareName: false, traits: profileFromAnswers(answers),
    wins: 0, losses: 0, photoStatus: "approved", boardOptIn: false,
    moralAnswers: moral, natureScore: moralScore(moral), moralAnswered: moralAnswered(moral),
    elo: BASE_ELO,
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

test("mutualMatches requires both to rate each other over others, 3 times each", () => {
  const a = mkUser("a"), b = mkUser("b"), c = mkUser("c");
  for (let i = 0; i < 3; i++) recordVote(a, b, c); // a likes b (not yet mutual)
  assert.equal(mutualMatches(a, [a, b, c]).length, 0);
  for (let i = 0; i < MIN_MUTUAL_PICKS - 1; i++) recordVote(b, a, c);
  assert.equal(mutualMatches(a, [a, b, c]).length, 0); // mutual, but short of 3 picks
  recordVote(b, a, c); // third pick clears the gate
  const m = mutualMatches(a, [a, b, c]);
  assert.equal(m.length, 1);
  assert.equal(m[0].user.id, "b");
  assert.ok(m[0].youPickRate > 0 && m[0].theyPickRate > 0);
  assert.equal(m[0].natureGap, 0);
});

test("a Human Nature gap wider than the window blocks an otherwise-mutual match", () => {
  const a = mkUser("a", answersAll(1), { moralAnswers: moralAll(2) });
  const b = mkUser("b", answersAll(-1), { moralAnswers: moralAll(-2) });
  const c = mkUser("c");
  assert.ok(Math.abs(a.natureScore - b.natureScore) > NATURE_WINDOW);
  for (let i = 0; i < 3; i++) { recordVote(a, b, c); recordVote(b, a, c); }
  assert.equal(canMatch(a, b), false);
  const gates = matchGates(a, b);
  assert.equal(gates.mutual, true);
  assert.equal(gates.picks, true);
  assert.equal(gates.nature, false);
  // ...and it surfaces as an "almost" so the user knows why.
  const near = nearMatches(a, [a, b, c]);
  assert.equal(near.length, 1);
  assert.equal(near[0].blockedBy, "nature");
});

test("canMatch clears once picks, the nature window and the quiz are all satisfied", () => {
  const a = mkUser("a", answersAll(0.5)), b = mkUser("b", answersAll(0.5)), c = mkUser("c");
  assert.equal(canMatch(a, b), false);
  for (let i = 0; i < MIN_MUTUAL_PICKS; i++) { recordVote(a, b, c); recordVote(b, a, c); }
  assert.equal(matchGates(a, b).natureGap, 0);
  assert.equal(canMatch(a, b), true);
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
  for (let i = 0; i < 3; i++) recordVote(a, b, c); // a likes b, not mutual yet
  let r = report(a, pop);
  assert.equal(r.matches.length, 0);
  assert.equal(r.crushes, 1); // liked b, not matched back
  for (let i = 0; i < 3; i++) recordVote(b, a, c); // mutual and past the pick gate
  r = report(a, pop);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].id, "b");
  assert.ok(Array.isArray(r.likedBy) && typeof r.yourType.text === "string");
  assert.ok(r.attractivenessPercentile >= 0 && r.attractivenessPercentile <= 100);
  assert.equal(typeof r.natureScore, "number");
});

test("moralScore spans -72..+72 and the verdict bands track it", () => {
  assert.equal(MORAL_QUESTIONS.length, 36);
  assert.equal(moralScore(moralAll(-2)), -72);
  assert.equal(moralScore(moralAll(2)), 72);
  assert.equal(moralScore({}), 0);
  assert.equal(moralVerdict(-72).label, "Sanctimonious");
  assert.equal(moralVerdict(72).label, "Irredeemable");
  // Every option really is in -2..+2, or the 25-point window means nothing.
  for (const q of MORAL_QUESTIONS) {
    assert.equal(q.options.length, 5);
    for (const o of q.options) assert.ok(Number.isInteger(o.value) && Math.abs(o.value) <= 2);
  }
});

test("moralBreakdown splits the score across all six vices", () => {
  const b = moralBreakdown(moralAll(2));
  assert.deepEqual(Object.keys(b).sort(), ["apathy", "betrayal", "cruelty", "deceit", "depravity", "greed"]);
  for (const row of Object.values(b)) { assert.equal(row.answered, 6); assert.equal(row.score, 12); }
  assert.equal(Object.values(b).reduce((n, r) => n + r.score, 0), 72);
  assert.equal(worstVice(moralAll(2)).answered, 6);
});

test("skipping the morality quiz blocks a match no matter how much you pick each other", () => {
  const a = mkUser("a", undefined, { moralAnswers: {} });
  const b = mkUser("b", undefined, { moralAnswers: {} });
  const c = mkUser("c");
  assert.equal(quizDone(a), false);
  assert.equal(a.natureScore, b.natureScore); // both 0 — would match without the gate
  for (let i = 0; i < 5; i++) { recordVote(a, b, c); recordVote(b, a, c); }
  const gates = matchGates(a, b);
  assert.equal(gates.mutual, true);
  assert.equal(gates.picks, true);
  assert.equal(gates.nature, true);
  assert.equal(gates.quiz, false);
  assert.equal(canMatch(a, b), false);
  assert.equal(nearMatches(a, [a, b, c])[0].blockedBy, "your-quiz");
});

test("a partly-finished quiz still counts once it passes the minimum", () => {
  const partial = {};
  MORAL_QUESTIONS.slice(0, MORAL_MIN_ANSWERED).forEach((q) => { partial[q.id] = 2; });
  const u = mkUser("p", undefined, { moralAnswers: partial });
  assert.equal(moralAnswered(partial), MORAL_MIN_ANSWERED);
  assert.equal(quizDone(u), true);
  const oneShort = { ...partial };
  delete oneShort[MORAL_QUESTIONS[0].id];
  assert.equal(quizDone(mkUser("q", undefined, { moralAnswers: oneShort })), false);
});

test("the morality guessing axis reads the Human Nature score, not the trait vector", () => {
  const evil = mkUser("e", answersAll(0), { moralAnswers: moralAll(2) });
  const saint = mkUser("s", answersAll(0), { moralAnswers: moralAll(-2) });
  assert.equal(axisValue(evil, "moral"), 72);
  assert.equal(axisValue(saint, "moral"), -72);
  assert.equal(guessOutcome(evil, "moral", "high").correct, true);
  assert.equal(guessOutcome(saint, "moral", "high").correct, false);
  assert.equal(guessOutcome(saint, "moral", "low").actualLabel, "the better person");
});

test("the pool is anonymous: names never leave the profile except to a match", () => {
  const a = mkUser("a", answersAll(0)), b = mkUser("b", answersAll(0)), c = mkUser("c");
  a.name = "Alex"; b.name = "Bella"; b.shareName = true;
  const cShy = c; cShy.name = "Cara"; cShy.shareName = false;
  for (let i = 0; i < MIN_MUTUAL_PICKS; i++) { recordVote(a, b, c); recordVote(b, a, c); }
  const r = report(a, [a, b, c]);
  assert.equal(r.name, undefined); // the report itself carries no name
  assert.equal(r.matches[0].name, "Bella"); // shared
  b.shareName = false;
  assert.equal(report(a, [a, b, c]).matches[0].name, null); // withdrawn
});

test("recordVote tracks raw wins and losses, and winRate reports them plainly", () => {
  const a = mkUser("a"), b = mkUser("b"), c = mkUser("c");
  assert.equal(winRate(a), null); // never shown yet
  recordVote(a, b, c); recordVote(a, b, c); recordVote(a, c, b);
  assert.equal(b.wins, 2); assert.equal(b.losses, 1);
  assert.equal(winRate(b), 67);
  assert.equal(winRate(c), 33);
});

test("rankOf gives a position, and only ranks photos that have been shown", () => {
  const pop = [mkUser("a"), mkUser("b"), mkUser("c"), mkUser("unseen")];
  pop[0].elo = 1400; pop[1].elo = 1200; pop[2].elo = 1000;
  for (const u of pop.slice(0, 3)) u.matchups = 10;
  assert.deepEqual(rankOf(pop[0], pop), { rank: 1, of: 3, fromBottom: 3 });
  assert.deepEqual(rankOf(pop[2], pop), { rank: 3, of: 3, fromBottom: 1 });
  assert.equal(rankOf(pop[3], pop), null); // never shown -> not ranked, not "last"
});

test("rejectedBy counts distinct people, not votes", () => {
  const target = mkUser("t"), other = mkUser("o");
  const v1 = mkUser("v1"), v2 = mkUser("v2");
  recordVote(v1, other, target); // v1 passed on the target
  recordVote(v1, other, target); // ...twice; still one person
  recordVote(v2, target, other); // v2 picked the target
  const pop = [target, other, v1, v2];
  assert.equal(rejectedBy(target, pop), 1);
  assert.equal(chosenBy(target, pop), 1);
});

test("predictionDelta exposes how wrong you were about yourself", () => {
  const pop = [mkUser("a"), mkUser("b"), mkUser("c"), mkUser("d")];
  pop.forEach((u, i) => { u.elo = 1000 + i * 100; u.matchups = 10; u.prediction = 90; });
  const worst = predictionDelta(pop[0], pop); // lowest elo, predicted 90
  assert.equal(worst.predicted, 90);
  assert.equal(worst.overrated, true);
  assert.ok(worst.gap > 0);
  const nope = mkUser("np"); nope.prediction = null;
  assert.equal(predictionDelta(nope, pop), null);
});

test("dilemma reports only speak once there is something to say", () => {
  const u = mkUser("u");
  assert.equal(deathReport(u).leftPct, null);
  u.deathVotes = { saved: 1, left: 3 };
  assert.equal(deathReport(u).leftPct, 75);
  u.cheatVotes = { yes: 2, no: 3 };
  assert.equal(cheatReport(u).yesPct, 40);
});

test("the boards are opt-in, gated on real data, and empty by default", () => {
  const pop = [mkUser("a"), mkUser("b"), mkUser("c")];
  pop.forEach((u, i) => { u.elo = 1000 + i * 100; u.matchups = 100; u.photoStatus = "approved"; });
  assert.equal(leaderboard(pop).eligible, 0); // nobody opted in

  pop.forEach((u) => { u.boardOptIn = true; });
  const board = leaderboard(pop);
  assert.equal(board.eligible, 3);
  assert.equal(board.top[0].id, "c"); // highest elo
  assert.equal(board.bottom[0].id, "a"); // lowest
  assert.equal(board.bottom[0].rank, 3); // true rank, not renumbered

  // Too few matchups: opted in, but not exposed on a "worst rated" list yet.
  pop[0].matchups = BOARD_MIN_MATCHUPS - 1;
  assert.equal(boardEligible(pop[0]), false);
  assert.equal(leaderboard(pop).eligible, 2);

  // An unapproved photo never appears, opt-in or not.
  pop[1].photoStatus = "pending";
  assert.equal(boardEligible(pop[1]), false);
});
