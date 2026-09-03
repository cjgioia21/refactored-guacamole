// Core StudyMatch engine: Elo attractiveness from photo matchups, learned
// "type" (who you vote for) and "admirer" (who votes for you) profiles across
// traits + demographics, mutual (orientation-aware) attraction matchmaking,
// perceived reports, and guessing-game scoring. Everything centers on how
// attractive people are TO EACH OTHER.
import { AXES, axisLabel } from "./questions.js";
import { similarity, accumulate } from "./vectors.js";
import { MORAL_MIN_ANSWERED } from "./morality.js";

export const ELO_K = 32;
export const BASE_ELO = 1200;
export const GENDERS = ["man", "woman", "nonbinary"];
export const ORIENTATIONS = ["straight", "gay", "lesbian", "bi"];
export const MH_FLAGS = ["bipolar", "anxiety", "depression", "adhd", "ocd", "ptsd"];

function expected(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

export function updateElo(winnerElo, loserElo, k = ELO_K) {
  const ew = expected(winnerElo, loserElo);
  return { winner: winnerElo + k * (1 - ew), loser: loserElo + k * (0 - (1 - ew)) };
}

// Which genders a person is attracted to, from orientation + own gender.
export function attractedGenders(orientation, gender) {
  switch (orientation) {
    case "straight":
      if (gender === "man") return ["woman"];
      if (gender === "woman") return ["man"];
      return GENDERS;
    case "gay":
      return gender === "woman" ? ["woman"] : ["man"];
    case "lesbian":
      return ["woman"];
    case "bi":
      return GENDERS;
    default:
      return GENDERS;
  }
}

// Record a vote: `voter` chose `winner`'s photo over `loser`'s.
// Mutates all three (Elo, counts) and learns the voter's type + winner's admirers.
export function recordVote(voter, winner, loser) {
  const { winner: wElo, loser: lElo } = updateElo(winner.elo, loser.elo);
  winner.elo = wElo;
  loser.elo = lElo;
  winner.matchups = (winner.matchups || 0) + 1;
  loser.matchups = (loser.matchups || 0) + 1;
  // Raw win/loss tallies. Elo is a smoothed opinion; these are the plain facts,
  // and the report shows them without softening.
  winner.wins = (winner.wins || 0) + 1;
  loser.losses = (loser.losses || 0) + 1;

  // Voter is attracted to the winner -> learn the voter's "type".
  learnPreference(voter.type, winner, voter);
  accumulate(voter.type, winner.traits); // trait fit
  // Winner is found attractive by this voter -> learn who admires them.
  accumulate(winner.admirers, voter.traits);
  aggregateFan(winner, voter); // demographic breakdown of "who likes you"

  // Revealed preference: record that the voter rated `winner` over `loser`.
  bumpRating(voter, winner.id, "w");
  bumpRating(voter, loser.id, "l");

  voter.votesCast = (voter.votesCast || 0) + 1;
  return { winner, loser };
}

// Fold a fan's demographics into the winner's fan aggregate.
function aggregateFan(winner, voter) {
  const f = winner.fans || (winner.fans = { n: 0, mh: {}, gender: {}, ageSum: 0, ageN: 0 });
  f.n += 1;
  for (const flag of voter.mentalHealth || []) if (flag !== "none") f.mh[flag] = (f.mh[flag] || 0) + 1;
  if (voter.gender) f.gender[voter.gender] = (f.gender[voter.gender] || 0) + 1;
  if (voter.age) { f.ageSum += voter.age; f.ageN += 1; }
}

function bumpRating(voter, id, kind) {
  voter.ratings = voter.ratings || {};
  const r = voter.ratings[id] || (voter.ratings[id] = { w: 0, l: 0 });
  r[kind] += 1;
}

// Does `user` prefer `otherId` — i.e. rate their photo over others' more often
// than not? This is the revealed "you rated them higher than other people".
export function likes(user, otherId) {
  const r = user.ratings?.[otherId];
  return !!r && r.w > r.l;
}

// Share of matchups in which `user` chose `otherId` (0..1), for display.
export function pickRate(user, otherId) {
  const r = user.ratings?.[otherId];
  if (!r || r.w + r.l === 0) return 0;
  return r.w / (r.w + r.l);
}

// Fold a chosen winner's demographics into the voter's learned type buckets.
function learnPreference(type, winner, voter) {
  type.n = (type.n || 0) + 1;
  // age lean: mean(winnerAge - voterAge); >0 => prefers older
  if (winner.age && voter.age) {
    type.ageLean = ((type.ageLean || 0) * (type.n - 1) + (winner.age - voter.age)) / type.n;
    type.ageMean = ((type.ageMean || 0) * (type.n - 1) + winner.age) / type.n;
  }
  // gender preference counts
  type.gender = type.gender || {};
  if (winner.gender) type.gender[winner.gender] = (type.gender[winner.gender] || 0) + 1;
  // mental-health openness: how often chosen partners report an MH flag
  type.mh = type.mh || {};
  const flags = winner.mentalHealth || [];
  type.mhChosen = (type.mhChosen || 0) + (flags.length && !flags.includes("none") ? 1 : 0);
  for (const f of flags) if (f !== "none") type.mh[f] = (type.mh[f] || 0) + 1;
}

export function percentile(user, population) {
  const rated = population.filter((u) => (u.matchups || 0) > 0);
  if (rated.length <= 1) return 50;
  const below = rated.filter((u) => u.elo < user.elo).length;
  return Math.round((below / (rated.length - 1)) * 100);
}

export function describe(vector, limit = 4) {
  return Object.keys(AXES)
    .map((axis) => ({ axis, value: vector[axis] || 0, label: axisLabel(axis, vector[axis] || 0) }))
    .filter((t) => Math.abs(t.value) >= 0.15)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
}

// Human-readable summary of what a user is drawn to, learned from their votes.
export function typeSummary(user) {
  const t = user.type || {};
  const parts = [];
  // gender preference
  const g = t.gender || {};
  const topGender = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
  if (topGender) parts.push(pluralGender(topGender[0]));
  // age lean
  if (t.n && Math.abs(t.ageLean || 0) >= 1.5) {
    parts.push((t.ageLean > 0 ? "older" : "younger") + ` (~${Math.round(t.ageMean)})`);
  } else if (t.ageMean) {
    parts.push(`around your age (~${Math.round(t.ageMean)})`);
  }
  // mental-health openness
  if (t.n) {
    const share = (t.mhChosen || 0) / t.n;
    const topMh = Object.entries(t.mh || {}).sort((a, b) => b[1] - a[1])[0];
    if (share >= 0.5 && topMh) parts.push(`often ${topMh[0]}`);
    else if (share >= 0.25 && topMh) parts.push(`sometimes ${topMh[0]}`);
    else if (t.n >= 5 && share < 0.15) parts.push("no mental-health struggles");
  }
  // personality/politics
  for (const tr of describe(user.type.vector || {}, 3)) parts.push(tr.label);
  return { text: parts.join(", ") || "not enough data yet", parts };
}

export function report(user, population) {
  return {
    id: user.id,
    matchups: user.matchups || 0,
    elo: Math.round(user.elo),
    attractivenessPercentile: percentile(user, population),
    natureScore: user.natureScore || 0,
    // The unsoftened numbers.
    winRate: winRate(user),
    wins: user.wins || 0,
    losses: user.losses || 0,
    rank: rankOf(user, population),
    rejectedBy: rejectedBy(user, population),
    chosenBy: chosenBy(user, population),
    abandonedBy: abandonedBy(user, population),
    prediction: predictionDelta(user, population),
    death: deathReport(user),
    cheat: cheatReport(user),
    likedBy: describe(user.admirers.vector), // trait profile of admirers
    yourType: typeSummary(user), // learned from the photos you chose
    selfTraits: describe(user.traits),
    // The four mirrors — all derived from votes already cast.
    compatibilityGap: compatibilityGap(user, population),
    selfVsCrowd: selfVsCrowd(user),
    reciprocity: reciprocity(user, population),
  };
}

// Guessing game: guess an attribute of `target` from their photo.
// axis may be a trait axis, "age", "gender", or "mh".
export function guessOutcome(target, axis, guess) {
  if (axis === "age") {
    const older = (target.age || 0) >= 30;
    return { correct: guess === (older ? "30+" : "under 30"), actual: older ? "30+" : "under 30", actualLabel: `${target.age}` };
  }
  if (axis === "gender") {
    return { correct: guess === target.gender, actual: target.gender, actualLabel: target.gender };
  }
  if (axis === "mh") {
    const has = (target.mentalHealth || []).some((f) => f !== "none");
    return { correct: guess === (has ? "yes" : "no"), actual: has ? "yes" : "no", actualLabel: (target.mentalHealth || ["none"]).join(", ") };
  }
  if (axis === "moral") {
    const score = target.natureScore || 0;
    const truth = score >= 0 ? "high" : "low";
    return { correct: guess === truth, actual: truth, actualLabel: score >= 0 ? "the worse person" : "the better person", strength: Math.abs(score) / 72 };
  }
  const value = target.traits[axis] || 0;
  const [low, high] = AXES[axis];
  const truth = value >= 0 ? "high" : "low";
  return { correct: guess === truth, actual: truth, actualLabel: value >= 0 ? high : low, strength: Math.abs(value) };
}

// ---------- Guessing "games" catalogue (what strangers guess about a photo) ----------
// Each game guesses one trait axis; poles are flavored display labels.
// Each game maps to a trait axis, with a `title` for its page, a `selfQ` (the
// "first, the same question about you" question id), and display `poles`.
// ---------- The numbers, unsoftened ----------
// Everything here except wins/losses is derived from data already stored.

// The share of matchups you win. No confidence band, no cushioning.
export function winRate(user) {
  const w = user.wins || 0;
  const total = w + (user.losses || 0);
  return total ? Math.round((w / total) * 100) : null;
}

// An actual position, not a percentile: #4,182 of 5,003. Only profiles that
// have actually been shown are ranked, so a brand-new photo isn't "last".
export function rankOf(user, population) {
  const ranked = population
    .filter((u) => (u.matchups || 0) > 0)
    .sort((a, b) => b.elo - a.elo);
  const i = ranked.findIndex((u) => u.id === user.id);
  if (i === -1) return null;
  return { rank: i + 1, of: ranked.length, fromBottom: ranked.length - i };
}

// How many distinct people saw this photo next to another and picked the other.
// Exact and free: every voter already stores ratings[targetId] = { w, l }.
export function rejectedBy(user, population) {
  return population.filter((o) => o.id !== user.id && (o.ratings?.[user.id]?.l || 0) > 0).length;
}
export function chosenBy(user, population) {
  return population.filter((o) => o.id !== user.id && (o.ratings?.[user.id]?.w || 0) > 0).length;
}

// The cruellest number the data holds: people who picked you at least once and
// then, later, looked at you next to someone else and picked them instead.
// Not strangers who never wanted you — people who did, and changed their mind.
export function abandonedBy(user, population) {
  return population.filter((o) => {
    if (o.id === user.id) return false;
    const r = o.ratings?.[user.id];
    return (r?.w || 0) > 0 && (r?.l || 0) > 0;
  }).length;
}

// The gap between what you predicted about yourself and what strangers said.
// Positive `gap` means you overrated yourself, which is the interesting case.
export function predictionDelta(user, population) {
  if (user.prediction == null || !(user.matchups || 0)) return null;
  const actual = percentile(user, population);
  const gap = user.prediction - actual;
  const others = population
    .filter((u) => u.id !== user.id && u.prediction != null && (u.matchups || 0) > 0)
    .map((u) => u.prediction - percentile(u, population));
  // Where your self-delusion ranks against everyone else's.
  const worse = others.filter((g) => g > gap).length;
  return {
    predicted: user.prediction,
    actual,
    gap,
    overrated: gap > 0,
    rankAmongDelusional: others.length >= 3 ? worse + 1 : null,
    ofDelusional: others.length >= 3 ? others.length + 1 : null,
  };
}

// ---------- The Top 10 ----------
// Ranked strictly by the share of head-to-head matchups won — who other people
// actually pick. Making it is an achievement; there is no opt-out, because
// appearing here is a term of putting your face in the pool (see legal/terms.md).
//
// The matchup floor is what keeps it honest: without it a 2-0 record reads as
// 100% and owns the board on pure noise.
export const BOARD_MIN_MATCHUPS = 50;

// A participant is anyone whose photo is live. Voters have no photo and are
// never ranked.
export const isParticipant = (user) => user?.photoStatus === "approved";
export const boardEligible = (user) => isParticipant(user) && (user?.matchups || 0) >= BOARD_MIN_MATCHUPS;

// Win rate first, then matchups — someone who went 60% over 400 pairs outranks
// someone who went 60% over 51.
const byWinRate = (a, b) => (winRate(b) - winRate(a)) || ((b.matchups || 0) - (a.matchups || 0));

// Everyone eligible in one gender cohort, best first.
export function rankedCohort(population, gender) {
  return population
    .filter((u) => boardEligible(u) && (!gender || u.gender === gender))
    .sort(byWinRate);
}

const boardRow = (u, i, of) => ({
  id: u.id,
  rank: i + 1,
  of,
  winRate: winRate(u),
  wins: u.wins || 0,
  losses: u.losses || 0,
  matchups: u.matchups || 0,
});

// The Top N for one gender.
export function topTen(population, gender, { limit = 10 } = {}) {
  const ranked = rankedCohort(population, gender);
  return {
    gender,
    of: ranked.length,
    minMatchups: BOARD_MIN_MATCHUPS,
    rows: ranked.slice(0, limit).map((u, i) => boardRow(u, i, ranked.length)),
  };
}

// Which cohorts have anyone in them — so the UI renders a board per gender
// actually present rather than assuming two.
export function boardGenders(population) {
  const seen = new Set(population.filter(boardEligible).map((u) => u.gender).filter(Boolean));
  return ["woman", "man", "nonbinary"].filter((g) => seen.has(g));
}

// Where one person stands in their own cohort. Everyone who is not in the Top 10
// still sees this, which is the whole point: a rank and a percentile for all.
export function standingOf(user, population) {
  if (!isParticipant(user)) return null;
  const cohort = rankedCohort(population, user.gender);
  const i = cohort.findIndex((u) => u.id === user.id);
  if (i === -1) {
    // Live photo, but not enough matchups yet to be placed.
    return {
      ranked: false,
      gender: user.gender,
      winRate: winRate(user),
      matchups: user.matchups || 0,
      minMatchups: BOARD_MIN_MATCHUPS,
      toGo: Math.max(0, BOARD_MIN_MATCHUPS - (user.matchups || 0)),
    };
  }
  return {
    ranked: true,
    gender: user.gender,
    rank: i + 1,
    of: cohort.length,
    inTopTen: i < 10,
    winRate: winRate(user),
    wins: user.wins || 0,
    losses: user.losses || 0,
    matchups: user.matchups || 0,
    // "Top 12.4%" — one decimal, because at this scale whole numbers lie.
    percentile: cohort.length > 1 ? Math.round((((i + 1) / cohort.length) * 100) * 10) / 10 : 100,
  };
}

// ---------- The four mirrors ----------
// Every one of these is computed from votes already cast. No new collection.

// Compatibility Gap: the average attractiveness percentile of the people you
// pick, against the average percentile of the people who pick you. A wide gap
// means you reach for people the platform's own ratings put above you.
export function compatibilityGap(user, population) {
  const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  // Everyone you picked at least once.
  const yourType = mean(
    population
      .filter((o) => o.id !== user.id && (user.ratings?.[o.id]?.w || 0) > 0)
      .map((o) => percentile(o, population))
  );
  // Everyone who picked you at least once.
  const yourFans = mean(
    population
      .filter((o) => o.id !== user.id && (o.ratings?.[user.id]?.w || 0) > 0)
      .map((o) => percentile(o, population))
  );

  if (yourType == null || yourFans == null) return { yourType, yourFans, gap: null, verdict: null };
  const gap = yourType - yourFans;
  return { yourType, yourFans, gap, verdict: gapVerdict(gap) };
}

// Stated plainly, with no advice attached and no softening. The bars either
// line up or they don't.
function gapVerdict(gap) {
  if (gap >= 25) return "you consistently reach well above your weight — they rarely look back";
  if (gap >= 12) return "you aim higher than the people aiming at you";
  if (gap <= -25) return "the people drawn to you rate far higher than the people you go for";
  if (gap <= -12) return "you are wanted by people you don't go for";
  return "your taste and your appeal are well matched";
}

// Self-Report vs. Reality: what you said about yourself on each axis, beside
// what strangers guessed from the photo alone. Nothing is omitted.
export function selfVsCrowd(user) {
  return GAMES.map((game) => {
    const consensus = guessConsensus(user, game);
    const selfValue = axisValue(user, game.axis); // -1..1, or the nature score
    // Normalize both onto 0..100 so the two columns are comparable at a glance.
    const selfPct = game.axis === "moral"
      ? Math.round(((selfValue / 72) + 1) / 2 * 100)
      : Math.round(((selfValue + 1) / 2) * 100);
    return {
      key: game.key,
      label: game.label,
      emoji: game.emoji,
      poles: game.poles,
      self: selfPct,
      answered: game.axis === "moral" ? (user.moralAnswered || 0) > 0 : hasAnswered(user, game.axis),
      crowd: consensus.ready
        ? { pct: consensus.pole === game.poles[1] ? consensus.pct : 100 - consensus.pct, pole: consensus.pole, total: consensus.total }
        : null,
      total: consensus.total,
    };
  });
}
const hasAnswered = (user, axis) => Object.values(user.traits || {}).length > 0 && (user.traits[axis] ?? null) !== null;

// Reciprocity: of the distinct people you picked over someone else, how many
// picked you back. Not a measure of attractiveness — a measure of whether who
// you want and who wants you are the same people.
export function reciprocity(user, population) {
  const chosen = population.filter((o) => o.id !== user.id && likes(user, o.id));
  const back = chosen.filter((o) => likes(o, user.id));
  const rate = chosen.length ? back.length / chosen.length : null;
  return {
    chosen: chosen.length,
    back: back.length,
    rate: rate == null ? null : Math.round(rate * 100),
    percentile: rate == null ? null : reciprocityPercentile(user, population, rate),
  };
}

// Where that rate sits against everyone else who has chosen enough people for
// their own rate to mean anything.
function reciprocityPercentile(user, population, rate) {
  const others = population
    .filter((o) => o.id !== user.id)
    .map((o) => {
      const chosen = population.filter((x) => x.id !== o.id && likes(o, x.id));
      if (chosen.length < 5) return null;
      return chosen.filter((x) => likes(x, o.id)).length / chosen.length;
    })
    .filter((r) => r != null);
  if (others.length < 3) return null;
  return Math.round((others.filter((r) => r < rate).length / others.length) * 100);
}

// Morality vs. Attractiveness: one dot per qualifying user. No trend line, no
// caption, no conclusion — the chart just sits there.
export function moralityVsLooks(population, viewer) {
  const qualifying = population.filter(
    (u) => (u.moralAnswered || 0) >= MORAL_MIN_ANSWERED && (u.matchups || 0) >= BOARD_MIN_MATCHUPS
  );
  return {
    minMatchups: BOARD_MIN_MATCHUPS,
    points: qualifying.map((u) => ({
      x: u.natureScore || 0,
      y: percentile(u, population),
      you: !!viewer && u.id === viewer.id,
    })),
    // Included so the viewer can find themselves even before the chart renders.
    you: viewer && qualifying.some((u) => u.id === viewer.id)
      ? { x: viewer.natureScore || 0, y: percentile(viewer, population) }
      : null,
  };
}

// ---------- Dilemma rounds ----------
// Preference votes, not guesses — there is no correct answer, so these never
// touch guessOutcome or the accuracy stats.
export function deathReport(user) {
  const d = user.deathVotes || { saved: 0, left: 0 };
  const total = d.saved + d.left;
  return { total, saved: d.saved, left: d.left, leftPct: total ? Math.round((d.left / total) * 100) : null };
}
export function cheatReport(user) {
  const c = user.cheatVotes || { yes: 0, no: 0 };
  const total = c.yes + c.no;
  return { total, yes: c.yes, no: c.no, yesPct: total ? Math.round((c.yes / total) * 100) : null };
}

export const GAMES = [
  { key: "bodycount", label: "Bodycount", emoji: "🍑", axis: "bodycount", selfQ: "bc1",
    title: "Guess who has a higher bodycount", poles: ["lower bodycount", "higher bodycount"] },
  { key: "networth", label: "Net worth", emoji: "💰", axis: "networth", selfQ: "nw0",
    title: "Guess who has more net worth", poles: ["less net worth", "more net worth"] },
  { key: "politics", label: "Politics", emoji: "🗳️", axis: "pol", selfQ: "pol11",
    title: "Guess who is more politically left-leaning", poles: ["more left", "more right"] },
  { key: "dominance", label: "Dominance", emoji: "⛓️", axis: "dom", selfQ: "dom2",
    title: "Guess who is more dominant (in the bedroom)", poles: ["more submissive", "more dominant"] },
  { key: "gooner", label: "Gooner Nature", emoji: "💦", axis: "gooner", selfQ: "gn1",
    title: "Guess who is more of a gooner", poles: ["more tame", "more of a gooner"] },
  // Scored off the morality quiz rather than a trait axis — see axisValue().
  { key: "morality", label: "Who's worse", emoji: "😈", axis: "moral", selfQ: "gr1", selfBank: "moral",
    title: "Guess who scored worse on the morality quiz", poles: ["the better person", "the worse person"] },
];

// The comparable value behind a guessing axis. Trait axes read the -1..1 trait
// vector; the morality axis reads the Human Nature score instead, so the same
// two-photo comparison round works for both.
export function axisValue(user, axis) {
  if (axis === "moral") return user?.natureScore || 0;
  return user?.traits?.[axis] || 0;
}

// Axes a two-photo comparison round can be played on.
export const VERSUS_AXES = [...Object.keys(AXES), "moral"];
export const gameByKey = (k) => GAMES.find((g) => g.key === k) || null;

// ---------- "Your taste": what your rating choices reveal about your type ----------
// Cards unlock progressively as you rate more people.
// A new taste trait unlocks every TASTE_EVERY people you rate.
export const TASTE_EVERY = 75;
export const TASTES = [
  { key: "politics", axis: "pol", emoji: "🗳️", title: "Politics taste", verb: "you prefer", low: "left-leaning", high: "right-leaning", ends: ["left-leaning", "right-leaning"] },
  { key: "money", axis: "networth", emoji: "💰", title: "Money taste", verb: "you lean toward", low: "broke", high: "rich", ends: ["broke", "rich"] },
  { key: "bodycount", axis: "bodycount", emoji: "🍑", title: "Bodycount taste", verb: "you go for", low: "low-count", high: "high-count", ends: ["low count", "high count"] },
  { key: "dominance", axis: "dom", emoji: "⛓️", title: "Dominance taste", verb: "you prefer", low: "submissive", high: "dominant", ends: ["submissive", "dominant"] },
  { key: "mental", axis: "__mh", emoji: "💊", title: "Mentally ill taste", verb: "you're drawn to", low: "stable", high: "mentally ill", ends: ["avoids", "drawn"], unit: "diagnoses" },
  { key: "gooner", axis: "gooner", emoji: "💦", title: "Gooner taste", verb: "you're drawn to", low: "tame", high: "gooner", ends: ["tame", "gooner"] },
].map((t, i) => ({ ...t, unlockAt: (i + 1) * TASTE_EVERY }));

function mhBaseRate(population) {
  const rated = population.length || 1;
  const with_ = population.filter((u) => (u.mentalHealth || []).some((f) => f !== "none")).length;
  return with_ / rated;
}
function tasteValue(voter, taste, population) {
  if (taste.axis === "__mh") {
    const n = voter.type?.n || 0;
    if (!n) return 0;
    const pickRate = (voter.type.mhChosen || 0) / n;
    return Math.max(-1, Math.min(1, (pickRate - mhBaseRate(population)) * 2));
  }
  return voter.type?.vector?.[taste.axis] || 0;
}
function tasteGender(voter) {
  const g = voter.type?.gender || {};
  const top = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
  return { man: "men", woman: "women", nonbinary: "enbies" }[top?.[0]] || "people";
}

// A taste report: one card per axis, unlocked once you've rated enough people.
export function tasteReport(voter, population) {
  const votes = voter.votesCast || 0;
  const raters = population.filter((u) => u.id !== voter.id && (u.votesCast || 0) > 0 && u.type?.n);
  return TASTES.map((t) => {
    const unlocked = votes >= t.unlockAt;
    const value = tasteValue(voter, t, population);
    const sign = value >= 0 ? 1 : -1;
    const mine = Math.abs(value);
    // "more than X% of raters" — you lean toward your pole harder than they do.
    let pct = 50;
    if (raters.length) {
      const weaker = raters.filter((u) => sign * tasteValue(u, t, population) < mine).length;
      pct = Math.min(99, Math.round((weaker / raters.length) * 100));
    }
    return {
      key: t.key, emoji: t.emoji, title: t.title, verb: t.verb, unit: t.unit || null,
      ends: t.ends, unlocked, unlockAt: t.unlockAt, votesToGo: Math.max(0, t.unlockAt - votes),
      gender: tasteGender(voter),
      pole: value >= 0 ? t.high : t.low,
      value: Math.round(value * 10) / 10,
      position: Math.round(((value + 1) / 2) * 100), // 0..100 for the slider knob
      pct,
    };
  });
}

// ---------- Credit economy: attractiveness band, guess consensus, fan report ----------
export const ESTABLISHED_MIN = 8; // matchups before a photo is "established"
export const PAIRS_TARGET = 400; // matchup appearances that "complete" the data
export const REVEAL_MIN = 5; // guesses received before a trait can be revealed

// Attractiveness as a confidence band that narrows with more matchups.
export function attractivenessBand(user, population) {
  const p = percentile(user, population);
  const m = user.matchups || 0;
  const margin = Math.max(2, Math.min(45, Math.round(45 / Math.sqrt(m + 1))));
  const established = population.filter((u) => (u.matchups || 0) >= ESTABLISHED_MIN).length;
  return {
    percentile: p,
    low: Math.max(0, p - margin),
    high: Math.min(100, p + margin),
    established,
    pairs: Math.min(m, PAIRS_TARGET + (user.priorityPairs || 0)),
    pairsTarget: PAIRS_TARGET + (user.priorityPairs || 0),
  };
}

// What strangers collectively guessed about this photo on one game/axis.
export function guessConsensus(user, game) {
  const counts = user.guessesReceived?.[game.axis] || {};
  const total = (counts.low || 0) + (counts.high || 0);
  if (total < REVEAL_MIN) return { ready: false, total };
  const highShare = (counts.high || 0) / total;
  const pole = highShare >= 0.5 ? game.poles[1] : game.poles[0];
  return { ready: true, total, pole, pct: Math.round(Math.max(highShare, 1 - highShare) * 100) };
}

// Demographic breakdown of the people who pick this photo ("Who Likes You?").
export function fansReport(user, population) {
  const f = user.fans || { n: 0, mh: {}, gender: {}, ageSum: 0, ageN: 0 };
  // Baseline mental-health prevalence across the population.
  const base = {};
  let baseN = 0;
  for (const u of population) {
    baseN += 1;
    for (const flag of u.mentalHealth || []) if (flag !== "none") base[flag] = (base[flag] || 0) + 1;
  }
  const overrep = Object.entries(f.mh)
    .map(([flag, c]) => {
      const fanRate = c / (f.n || 1);
      const popRate = (base[flag] || 0) / (baseN || 1);
      return { flag, fanRate, lift: popRate ? fanRate / popRate : fanRate > 0 ? 3 : 0 };
    })
    .filter((x) => x.fanRate > 0)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 4)
    .map((x) => ({ flag: x.flag, pct: Math.round(x.fanRate * 100), lift: Math.round(x.lift * 10) / 10 }));
  return {
    fans: f.n,
    traits: describe(user.admirers.vector, 5), // politics/religion/personality lean
    mentalHealth: overrep,
    genderSplit: f.gender,
    avgAge: f.ageN ? Math.round(f.ageSum / f.ageN) : null,
  };
}

function pluralGender(g) {
  return { man: "men", woman: "women", nonbinary: "nonbinary people" }[g] || g;
}
