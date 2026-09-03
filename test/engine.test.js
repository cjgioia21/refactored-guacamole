import { test } from "node:test";
import assert from "node:assert/strict";
import { profileFromAnswers, QUESTIONS, AXES } from "../src/questions.js";
import { MORAL_QUESTIONS, moralScore, moralAnswered, moralVerdict, moralBreakdown, worstVice, MORAL_MIN_ANSWERED } from "../src/morality.js";
import { similarity, emptyAcc } from "../src/vectors.js";
import {
  updateElo, recordVote, percentile, guessOutcome,
  report, typeSummary, attractedGenders, likes, pickRate,
  attractivenessBand, guessConsensus, fansReport, tasteReport, GAMES, TASTES, BASE_ELO, REVEAL_MIN,
  axisValue, winRate, rankOf, rejectedBy, chosenBy, abandonedBy, predictionDelta,
  deathReport, cheatReport, topTen, standingOf, rankedCohort, boardGenders,
  boardEligible, isParticipant, BOARD_MIN_MATCHUPS,
  compatibilityGap, reciprocity, selfVsCrowd, moralityVsLooks,
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

test("report carries the stats and the four mirrors, and nothing about matching", () => {
  const a = mkUser("a", answersAll(0.6), { gender: "man" });
  const b = mkUser("b", answersAll(0.5), { gender: "woman" });
  const c = mkUser("c", answersAll(-0.6), { gender: "woman" });
  const pop = [a, b, c];
  for (let i = 0; i < 3; i++) recordVote(a, b, c);
  for (let i = 0; i < 3; i++) recordVote(b, a, c);
  const r = report(a, pop);

  assert.ok(Array.isArray(r.likedBy) && typeof r.yourType.text === "string");
  assert.ok(r.attractivenessPercentile >= 0 && r.attractivenessPercentile <= 100);
  assert.equal(typeof r.natureScore, "number");
  // The four mirrors are present...
  assert.ok(r.compatibilityGap && Array.isArray(r.selfVsCrowd) && r.reciprocity);
  // ...and every trace of the dating layer is gone.
  for (const gone of ["matches", "crushes", "almost", "suggestions"]) {
    assert.equal(r[gone], undefined, `report should no longer carry ${gone}`);
  }
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

test("the morality guessing axis reads the Human Nature score, not the trait vector", () => {
  const evil = mkUser("e", answersAll(0), { moralAnswers: moralAll(2) });
  const saint = mkUser("s", answersAll(0), { moralAnswers: moralAll(-2) });
  assert.equal(axisValue(evil, "moral"), 72);
  assert.equal(axisValue(saint, "moral"), -72);
  assert.equal(guessOutcome(evil, "moral", "high").correct, true);
  assert.equal(guessOutcome(saint, "moral", "high").correct, false);
  assert.equal(guessOutcome(saint, "moral", "low").actualLabel, "the better person");
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

test("abandonedBy counts only the people who picked you and then changed their mind", () => {
  const target = mkUser("t"), other = mkUser("o");
  const loyal = mkUser("loyal"), never = mkUser("never"), fickle = mkUser("fickle");
  recordVote(loyal, target, other); // always picks the target
  recordVote(loyal, target, other);
  recordVote(never, other, target); // never picks the target
  recordVote(fickle, target, other); // picked them once...
  recordVote(fickle, other, target); // ...then picked someone else
  const pop = [target, other, loyal, never, fickle];

  assert.equal(abandonedBy(target, pop), 1); // only the fickle one counts
  assert.equal(rejectedBy(target, pop), 2); // never + fickle both passed at least once
  assert.equal(chosenBy(target, pop), 2); // loyal + fickle both picked at least once
  assert.equal(abandonedBy(loyal, pop), 0); // nobody has rated the voter at all
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


// ---- The Top 10 ----

// A participant with a live photo and a known W/L record.
const mkPlayer = (id, gender, wins, losses, extra = {}) =>
  mkUser(id, undefined, { gender, wins, losses, matchups: wins + losses, photoStatus: "approved", ...extra });

test("topTen ranks strictly by win percentage, per gender", () => {
  const pop = [
    mkPlayer("w1", "woman", 90, 10),  // 90%
    mkPlayer("w2", "woman", 70, 30),  // 70%
    mkPlayer("w3", "woman", 51, 49),  // 51%
    mkPlayer("m1", "man", 80, 20),    // 80%
  ];
  const women = topTen(pop, "woman");
  assert.deepEqual(women.rows.map((r) => r.id), ["w1", "w2", "w3"]);
  assert.deepEqual(women.rows.map((r) => r.winRate), [90, 70, 51]);
  assert.equal(women.of, 3);
  // Elo plays no part: a lower-Elo player with a better win rate still leads.
  pop[2].elo = 9999;
  assert.equal(topTen(pop, "woman").rows[0].id, "w1");
  // Boards are per gender.
  assert.deepEqual(topTen(pop, "man").rows.map((r) => r.id), ["m1"]);
  assert.deepEqual(boardGenders(pop), ["woman", "man"]);
});

test("the matchup floor keeps a 2-0 record off the board", () => {
  const pop = [mkPlayer("real", "woman", 60, 40), mkPlayer("fluke", "woman", 2, 0)];
  assert.equal(winRate(pop[1]), 100); // undeniably 100%...
  assert.equal(boardEligible(pop[1]), false); // ...and correctly not ranked
  assert.deepEqual(topTen(pop, "woman").rows.map((r) => r.id), ["real"]);
});

test("ties on win rate break toward the bigger sample", () => {
  const pop = [mkPlayer("few", "woman", 30, 20), mkPlayer("many", "woman", 240, 160)]; // both 60%
  assert.deepEqual(topTen(pop, "woman").rows.map((r) => r.id), ["many", "few"]);
});

test("voters are never ranked; participants always get a standing", () => {
  const voter = mkUser("v", undefined, { gender: "woman", photoStatus: "pending", matchups: 0 });
  assert.equal(isParticipant(voter), false);
  assert.equal(standingOf(voter, [voter]), null);

  const pop = [mkPlayer("a", "woman", 90, 10), mkPlayer("b", "woman", 50, 50), mkPlayer("c", "woman", 10, 90)];
  const last = standingOf(pop[2], pop);
  assert.equal(last.ranked, true);
  assert.equal(last.rank, 3);
  assert.equal(last.of, 3);
  assert.equal(last.winRate, 10);
  assert.equal(last.percentile, 100); // bottom of three
  assert.equal(standingOf(pop[0], pop).percentile, 33.3); // "Top 33.3%"
  assert.equal(standingOf(pop[0], pop).inTopTen, true);
});

test("a participant under the floor is told how many matchups they still need", () => {
  const almost = mkPlayer("x", "man", 20, 10); // 30 matchups
  const s = standingOf(almost, [almost]);
  assert.equal(s.ranked, false);
  assert.equal(s.toGo, BOARD_MIN_MATCHUPS - 30);
});

// ---- The four mirrors ----

test("compatibilityGap compares who you pick against who picks you", () => {
  // A hot target, a cold one, and a viewer who only ever picks the hot one.
  const hot = mkPlayer("hot", "woman", 90, 10, { elo: 1600 });
  const cold = mkPlayer("cold", "woman", 10, 90, { elo: 1000 });
  const me = mkPlayer("me", "man", 20, 80, { elo: 1100 });
  const pop = [hot, cold, me];

  recordVote(me, hot, cold); // I reach for the hot one
  recordVote(cold, me, hot); // the cold one reaches for me

  const g = compatibilityGap(me, pop);
  assert.equal(g.yourType, percentile(hot, pop));
  assert.equal(g.yourFans, percentile(cold, pop));
  assert.ok(g.gap > 0, "reaching above your weight is a positive gap");
  assert.match(g.verdict, /reach|higher/);

  // Nobody picked and nobody picking -> no verdict rather than a fake one.
  const lonely = mkPlayer("lonely", "man", 0, 0);
  assert.equal(compatibilityGap(lonely, [lonely]).gap, null);
});

test("reciprocity counts distinct people both ways", () => {
  const me = mkUser("me");
  const back1 = mkUser("b1"), back2 = mkUser("b2"), nope = mkUser("n"), other = mkUser("o");
  const pop = [me, back1, back2, nope, other];

  for (const t of [back1, back2, nope]) recordVote(me, t, other); // I chose three
  recordVote(back1, me, other); // two chose me back
  recordVote(back2, me, other);

  const r = reciprocity(me, pop);
  assert.equal(r.chosen, 3);
  assert.equal(r.back, 2);
  assert.equal(r.rate, 67);

  assert.equal(reciprocity(mkUser("never"), pop).rate, null); // chose nobody
});

test("selfVsCrowd returns every axis, with crowd null until there is consensus", () => {
  const u = mkUser("u", answersAll(0.5));
  const rows = selfVsCrowd(u);
  assert.equal(rows.length, GAMES.length); // nothing omitted
  assert.ok(rows.every((r) => typeof r.self === "number" && r.self >= 0 && r.self <= 100));
  assert.ok(rows.every((r) => r.crowd === null)); // no guesses received yet

  const game = GAMES[0];
  u.guessesReceived[game.axis] = { low: 1, high: REVEAL_MIN + 4 };
  const withCrowd = selfVsCrowd(u).find((r) => r.key === game.key);
  assert.ok(withCrowd.crowd && withCrowd.crowd.pct >= 50);
});

test("the scatter only plots people with a finished quiz and enough matchups", () => {
  const ok1 = mkPlayer("ok1", "woman", 60, 40, { moralAnswered: 36, natureScore: 20 });
  const ok2 = mkPlayer("ok2", "man", 40, 60, { moralAnswered: 36, natureScore: -30 });
  const noQuiz = mkPlayer("nq", "man", 60, 40, { moralAnswered: 0 });
  const tooFew = mkPlayer("tf", "man", 3, 2, { moralAnswered: 36 });
  const pop = [ok1, ok2, noQuiz, tooFew];

  const d = moralityVsLooks(pop, ok1);
  assert.equal(d.points.length, 2);
  assert.equal(d.points.filter((p) => p.you).length, 1);
  assert.ok(d.points.every((p) => p.x >= -72 && p.x <= 72 && p.y >= 0 && p.y <= 100));
  // Dots carry coordinates only — no ids leave the server.
  assert.deepEqual(Object.keys(d.points[0]).sort(), ["x", "y", "you"]);
});
