// Core StudyMatch engine: Elo attractiveness from photo matchups, learned
// "type" (who you vote for) and "admirer" (who votes for you) profiles across
// traits + demographics, mutual (orientation-aware) attraction matchmaking,
// perceived reports, and guessing-game scoring. Everything centers on how
// attractive people are TO EACH OTHER.
import { AXES, axisLabel } from "./questions.js";
import { similarity, accumulate } from "./vectors.js";

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

  // Voter is attracted to the winner -> learn the voter's "type".
  learnPreference(voter.type, winner, voter);
  accumulate(voter.type, winner.traits); // trait fit
  // Winner is found attractive by this voter -> learn who admires them.
  accumulate(winner.admirers, voter.traits);

  voter.votesCast = (voter.votesCast || 0) + 1;
  return { winner, loser };
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

// Predicted one-way attraction of `viewer` to `target`, 0..100.
// Orientation/gender prior × learned gender pref × type-fit × attractiveness.
function attractionScore(viewer, target, population) {
  const wants = attractedGenders(viewer.orientation, viewer.gender);
  const orientationFit = !target.gender || wants.includes(target.gender) ? 1 : 0.05;

  // learned gender preference (from votes), if any
  const g = viewer.type?.gender || {};
  const total = Object.values(g).reduce((a, b) => a + b, 0);
  const learnedGender = total && target.gender ? (g[target.gender] || 0) / total : null;
  const genderFit = learnedGender == null ? orientationFit : 0.5 * orientationFit + 0.5 * learnedGender;

  const traitFit = similarity(viewer.type?.vector || {}, target.traits); // 0..1
  const looks = percentile(target, population) / 100; // 0..1
  const typeWeight = Math.min((viewer.type?.n || 0) / 10, 1);
  const core =
    typeWeight * (0.6 * traitFit + 0.4 * looks) + (1 - typeWeight) * (0.5 * traitFit + 0.5 * looks);

  return Math.round(core * genderFit * 100);
}

// Mutual attraction — the harmonic mean of both directions.
export function matchScore(a, b, population) {
  const aLikesB = attractionScore(a, b, population);
  const bLikesA = attractionScore(b, a, population);
  const mutual = Math.round((2 * aLikesB * bLikesA) / (aLikesB + bLikesA || 1));
  return { score: mutual, aLikesB, bLikesA };
}

export function findMatches(user, population, { limit = 10 } = {}) {
  return population
    .filter((u) => u.id !== user.id)
    .map((u) => ({ user: u, ...matchScore(user, u, population) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

export function report(user, population) {
  return {
    id: user.id,
    name: user.name,
    matchups: user.matchups || 0,
    elo: Math.round(user.elo),
    attractivenessPercentile: percentile(user, population),
    likedBy: describe(user.admirers.vector), // trait profile of admirers
    yourType: typeSummary(user), // learned from the photos you chose
    selfTraits: describe(user.traits),
    topMatches: findMatches(user, population, { limit: 6 }).map((m) => ({
      id: m.user.id,
      name: m.user.name,
      score: m.score,
      theyLikeYou: m.bLikesA,
      youLikeThem: m.aLikesB,
    })),
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
  const value = target.traits[axis] || 0;
  const [low, high] = AXES[axis];
  const truth = value >= 0 ? "high" : "low";
  return { correct: guess === truth, actual: truth, actualLabel: value >= 0 ? high : low, strength: Math.abs(value) };
}

function pluralGender(g) {
  return { man: "men", woman: "women", nonbinary: "nonbinary people" }[g] || g;
}
