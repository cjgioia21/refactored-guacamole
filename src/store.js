// In-memory profile store with JSON file persistence.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { profileFromAnswers } from "./questions.js";
import { emptyAcc } from "./vectors.js";
import { BASE_ELO } from "./engine.js";

const DATA_FILE = new URL("../data/users.json", import.meta.url);

let users = load(DATA_FILE, []);

function load(file, fallback) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* corrupt/missing -> fallback */
  }
  return fallback;
}

function persist() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
  } catch {
    /* best-effort (e.g. read-only fs) */
  }
}

export function all() {
  return users;
}
export function get(id) {
  return users.find((u) => u.id === id) || null;
}
export function byAccount(accountId) {
  return users.find((u) => u.accountId === accountId) || null;
}

const cleanFlags = (v) =>
  (Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);

function normSocials(s) {
  if (!s || typeof s !== "object") return {};
  const out = {};
  for (const k of ["instagram", "twitter", "tiktok", "snapchat"]) {
    if (s[k]) out[k] = String(s[k]).slice(0, 60).replace(/^@/, "");
  }
  return out;
}

// Create a profile: name, photo, demographics, socials, questionnaire answers.
export function create(p = {}) {
  const user = {
    id: randomUUID(),
    accountId: p.accountId || null, // owning login account
    name: String(p.name || "Anonymous").slice(0, 80),
    photo: String(p.photo || "").slice(0, 500),
    age: Number(p.age) || null,
    gender: p.gender || null, // man | woman | nonbinary
    orientation: p.orientation || "straight", // straight | gay | lesbian | bi
    mentalHealth: cleanFlags(p.mentalHealth), // [] or e.g. ["anxiety"]
    socials: normSocials(p.socials), // PRIVATE — revealed only to a mutual match
    answers: p.answers || {},
    traits: profileFromAnswers(p.answers || {}),
    elo: BASE_ELO,
    matchups: 0,
    votesCast: 0,
    credits: 0,
    type: emptyAcc(), // what this user finds attractive (learned from votes)
    admirers: emptyAcc(), // who finds this user attractive
    ratings: {}, // { otherId: { w, l } } revealed preference from matchups
    guessStats: {}, // { axis: { correct, total } } guessing-game accuracy
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  persist();
  return user;
}

export function update(id, p = {}) {
  const user = get(id);
  if (!user) return null;
  if (p.name != null) user.name = String(p.name).slice(0, 80);
  if (p.photo != null) user.photo = String(p.photo).slice(0, 500);
  if (p.age != null) user.age = Number(p.age) || null;
  if (p.gender != null) user.gender = p.gender;
  if (p.orientation != null) user.orientation = p.orientation;
  if (p.mentalHealth != null) user.mentalHealth = cleanFlags(p.mentalHealth);
  if (p.socials != null) user.socials = normSocials(p.socials);
  if (p.answers != null) {
    user.answers = p.answers;
    user.traits = profileFromAnswers(p.answers);
  }
  persist();
  return user;
}

export function remove(id) {
  const before = users.length;
  users = users.filter((u) => u.id !== id);
  for (const u of users) if (u.ratings) delete u.ratings[id];
  persist();
  return users.length < before;
}

export function addCredits(id, n) {
  const user = get(id);
  if (user) {
    user.credits = (user.credits || 0) + n;
    persist();
  }
  return user;
}

// Record a guessing-game outcome for accuracy tracking.
export function recordGuess(id, axis, correct) {
  const user = get(id);
  if (!user) return;
  user.guessStats = user.guessStats || {};
  const s = user.guessStats[axis] || (user.guessStats[axis] = { correct: 0, total: 0 });
  s.total += 1;
  if (correct) s.correct += 1;
  persist();
}
export function guessStats(id) {
  const user = get(id);
  if (!user) return {};
  const out = {};
  for (const [axis, s] of Object.entries(user.guessStats || {})) {
    out[axis] = { ...s, accuracy: s.total ? Math.round((s.correct / s.total) * 100) : null };
  }
  return out;
}

// Matched-user view: reveals socials, which a mutual match consents to.
export function matchView(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, photo: u.photo, age: u.age, gender: u.gender, socials: u.socials };
}

export function save() {
  persist();
}

// Public shape — never leaks answers, accumulators, or socials.
export function publicView(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    photo: u.photo,
    age: u.age,
    gender: u.gender,
    orientation: u.orientation,
    elo: Math.round(u.elo),
    matchups: u.matchups || 0,
    credits: u.credits || 0,
  };
}
