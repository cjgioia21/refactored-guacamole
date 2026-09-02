// In-memory user store with JSON file persistence.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { profileFromAnswers } from "./questions.js";
import { emptyAcc } from "./vectors.js";
import { BASE_ELO } from "./engine.js";

const DATA_FILE = new URL("../data/users.json", import.meta.url);
const THREADS_FILE = new URL("../data/threads.json", import.meta.url);

let users = load(DATA_FILE, []);
let threads = load(THREADS_FILE, {}); // { pairKey: [{from, text, at}] }

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

function persistThreads() {
  try {
    writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2));
  } catch {
    /* best-effort */
  }
}

const pairKey = (a, b) => [a, b].sort().join("__");

export function all() {
  return users;
}
export function get(id) {
  return users.find((u) => u.id === id) || null;
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
    name: String(p.name || "Anonymous").slice(0, 80),
    photo: String(p.photo || "").slice(0, 500),
    age: Number(p.age) || null,
    gender: p.gender || null, // man | woman | nonbinary
    orientation: p.orientation || "straight", // straight | gay | lesbian | bi
    mentalHealth: cleanFlags(p.mentalHealth), // [] or e.g. ["anxiety"]
    socials: normSocials(p.socials), // PRIVATE — revealed only on mutual share
    answers: p.answers || {},
    traits: profileFromAnswers(p.answers || {}),
    elo: BASE_ELO,
    matchups: 0,
    votesCast: 0,
    credits: 0,
    type: emptyAcc(), // what this user finds attractive (learned from votes)
    admirers: emptyAcc(), // who finds this user attractive
    ratings: {}, // { otherId: { w, l } } revealed preference from matchups
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
  for (const u of users) {
    if (u.ratings) delete u.ratings[id];
  }
  for (const key of Object.keys(threads)) {
    if (key.split("__").includes(id)) delete threads[key];
  }
  persist();
  persistThreads();
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

// --- Messaging (unlocked only between mutually-matched users) ---

export function thread(a, b) {
  return threads[pairKey(a, b)] || [];
}

// Append a message. Caller must verify the two users are a mutual match.
export function addMessage(from, to, text) {
  const body = String(text || "").slice(0, 1000).trim();
  if (!body) return null;
  const key = pairKey(from, to);
  (threads[key] || (threads[key] = [])).push({ from, text: body, at: new Date().toISOString() });
  persistThreads();
  return threads[key];
}

// Matched-user view: reveals socials, which mutual matching consents to.
export function matchView(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, photo: u.photo, age: u.age, gender: u.gender, socials: u.socials };
}

export function save() {
  persist();
}

// Public shape — never leaks answers, accumulators, socials, or shares.
export function publicView(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    photo: u.photo,
    age: u.age,
    gender: u.gender,
    elo: Math.round(u.elo),
    matchups: u.matchups || 0,
    credits: u.credits || 0,
  };
}
