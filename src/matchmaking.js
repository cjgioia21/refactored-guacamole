// Study-partner matchmaking engine.
// Scores compatibility between users on subjects, availability, goals,
// study style, level and language, then ranks candidate partners.

export const WEIGHTS = {
  subjects: 35,
  availability: 25,
  goals: 15,
  style: 10,
  level: 10,
  language: 5,
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SLOTS = ["morning", "afternoon", "evening", "night"];
const LEVELS = ["beginner", "intermediate", "advanced", "expert"];

function normList(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
}

// Jaccard overlap of two string lists, in [0,1].
function overlap(a, b) {
  const sa = new Set(normList(a));
  const sb = new Set(normList(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Availability is a map { mon: ["morning","evening"], ... }.
// Returns fraction of shared day/slot cells over the union of busy cells.
function availabilityScore(a = {}, b = {}) {
  let shared = 0;
  let union = 0;
  for (const day of DAYS) {
    const sa = new Set(normList(a[day]).filter((s) => SLOTS.includes(s)));
    const sb = new Set(normList(b[day]).filter((s) => SLOTS.includes(s)));
    if (sa.size === 0 && sb.size === 0) continue;
    const cells = new Set([...sa, ...sb]);
    for (const c of cells) {
      union++;
      if (sa.has(c) && sb.has(c)) shared++;
    }
  }
  return union === 0 ? 0 : shared / union;
}

// Closer experience levels score higher; identical => 1.
function levelScore(a, b) {
  const ia = LEVELS.indexOf(String(a || "").toLowerCase());
  const ib = LEVELS.indexOf(String(b || "").toLowerCase());
  if (ia === -1 || ib === -1) return 0;
  const dist = Math.abs(ia - ib);
  return 1 - dist / (LEVELS.length - 1);
}

// Compatibility between two profiles, 0..100, with a per-factor breakdown.
export function compatibility(a, b) {
  const factors = {
    subjects: overlap(a.subjects, b.subjects),
    availability: availabilityScore(a.availability, b.availability),
    goals: overlap(a.goals, b.goals),
    style: a.style && b.style && a.style === b.style ? 1 : 0,
    level: levelScore(a.level, b.level),
    language: overlap(a.languages, b.languages),
  };

  let score = 0;
  let max = 0;
  const breakdown = {};
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const f = factors[key] ?? 0;
    score += f * weight;
    max += weight;
    breakdown[key] = Math.round(f * weight * 10) / 10;
  }

  return {
    score: Math.round((score / max) * 100),
    breakdown,
    sharedSubjects: normList(a.subjects).filter((s) =>
      normList(b.subjects).includes(s)
    ),
  };
}

// Rank all candidates against a user. Excludes self and returns sorted matches.
export function findMatches(user, candidates, { limit = 10, minScore = 1 } = {}) {
  return candidates
    .filter((c) => c.id !== user.id)
    .map((c) => {
      const { score, breakdown, sharedSubjects } = compatibility(user, c);
      return { user: c, score, breakdown, sharedSubjects };
    })
    .filter((m) => m.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// Greedy global pairing: pairs users to maximize summed compatibility.
// Leftover (odd count / no valid partner) is returned in `unpaired`.
export function pairAll(users, { minScore = 1 } = {}) {
  const edges = [];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const { score } = compatibility(users[i], users[j]);
      if (score >= minScore) edges.push({ a: users[i], b: users[j], score });
    }
  }
  edges.sort((x, y) => y.score - x.score);

  const used = new Set();
  const pairs = [];
  for (const e of edges) {
    if (used.has(e.a.id) || used.has(e.b.id)) continue;
    used.add(e.a.id);
    used.add(e.b.id);
    pairs.push(e);
  }
  const unpaired = users.filter((u) => !used.has(u.id));
  return { pairs, unpaired };
}

export const META = { DAYS, SLOTS, LEVELS };
