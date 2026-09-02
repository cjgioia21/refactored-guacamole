// In-memory profile store with JSON file persistence.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { profileFromAnswers } from "./questions.js";
import { emptyAcc } from "./vectors.js";
import { BASE_ELO } from "./engine.js";
import { dataFile } from "./paths.js";

const DATA_FILE = dataFile("users.json");

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

const PHOTO_MAX = 300000; // allow small uploaded data: URLs (downscaled client-side)
const cleanFlags = (v) =>
  (Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
const predict = (v) => (v == null || v === "" ? null : Math.max(0, Math.min(100, Number(v))));

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
    photo: String(p.photo || "").slice(0, PHOTO_MAX), // URL or uploaded data: URL
    age: Number(p.age) || null,
    gender: p.gender || null, // man | woman | nonbinary (base, for matching)
    genderIdentity: p.genderIdentity || null, // e.g. woman-trans, nb-afab
    orientation: p.orientation || "straight", // straight | gay | lesbian | bi
    ratingsFrom: p.ratingsFrom || null, // who you want ratings from: women | men
    prediction: predict(p.prediction), // self-predicted attractiveness 0..100
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
    guessesReceived: {}, // { axis: { low, high } } what strangers guessed about you
    fans: { n: 0, mh: {}, gender: {}, ageSum: 0, ageN: 0 }, // fan demographics
    revealed: {}, // { gameKey: true } trait reveals you've purchased
    fansUnlocked: false, // "Who Likes You?" demographic report unlocked
    emailOnNewData: false,
    priorityPairs: 0, // extra matchup priority purchased
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
  if (p.photo != null) user.photo = String(p.photo).slice(0, PHOTO_MAX);
  if (p.age != null) user.age = Number(p.age) || null;
  if (p.gender != null) user.gender = p.gender;
  if (p.genderIdentity != null) user.genderIdentity = p.genderIdentity;
  if (p.orientation != null) user.orientation = p.orientation;
  if (p.ratingsFrom != null) user.ratingsFrom = p.ratingsFrom;
  if (p.prediction != null) user.prediction = predict(p.prediction);
  if (p.mentalHealth != null) user.mentalHealth = cleanFlags(p.mentalHealth);
  if (p.socials != null) user.socials = normSocials(p.socials);
  if (p.answers != null) {
    user.answers = { ...(user.answers || {}), ...p.answers }; // merge, don't clobber
    user.traits = profileFromAnswers(user.answers);
  }
  persist();
  return user;
}

// Merge a single questionnaire answer and recompute the trait vector.
export function setAnswer(id, qid, optionIndex) {
  const user = get(id);
  if (!user) return null;
  user.answers = { ...(user.answers || {}), [qid]: Number(optionIndex) };
  user.traits = profileFromAnswers(user.answers);
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

// Record what a stranger guessed ABOUT a target's photo (low/high on an axis).
export function recordGuessAbout(targetId, axis, guessed) {
  const target = get(targetId);
  if (!target || (guessed !== "low" && guessed !== "high")) return;
  target.guessesReceived = target.guessesReceived || {};
  const g = target.guessesReceived[axis] || (target.guessesReceived[axis] = { low: 0, high: 0 });
  g[guessed] += 1;
  persist();
}

// Spend credits. Returns true on success, false if too few credits.
export function spend(id, cost) {
  const user = get(id);
  if (!user || (user.credits || 0) < cost) return false;
  user.credits -= cost;
  persist();
  return true;
}
export function reveal(id, gameKey) {
  const user = get(id);
  if (user) { (user.revealed || (user.revealed = {}))[gameKey] = true; persist(); }
}
export function unlockFans(id) {
  const user = get(id);
  if (user) { user.fansUnlocked = true; persist(); }
}
export function addPriorityPairs(id, n) {
  const user = get(id);
  if (user) { user.priorityPairs = (user.priorityPairs || 0) + n; persist(); }
}
export function setEmailPref(id, on) {
  const user = get(id);
  if (user) { user.emailOnNewData = !!on; persist(); }
  return user;
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
    votesCast: u.votesCast || 0,
  };
}
