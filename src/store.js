// In-memory user store with JSON file persistence.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { profileFromAnswers } from "./questions.js";
import { emptyAcc } from "./vectors.js";
import { BASE_ELO } from "./engine.js";

const DATA_FILE = new URL("../data/users.json", import.meta.url);

let users = load();

function load() {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch {
    /* corrupt/missing -> empty */
  }
  return [];
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
    shares: [], // ids this user opted to share socials with
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
  for (const u of users) u.shares = (u.shares || []).filter((s) => s !== id);
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

// Opt in to share socials with `targetId`. Returns { mutual }.
export function share(id, targetId) {
  const user = get(id);
  const target = get(targetId);
  if (!user || !target || id === targetId) return null;
  user.shares = user.shares || [];
  if (!user.shares.includes(targetId)) user.shares.push(targetId);
  persist();
  return { mutual: (target.shares || []).includes(id) };
}

// Connections for a user: everyone they've opted to share with, with the
// other person's socials revealed only when the opt-in is mutual.
export function connections(id) {
  const user = get(id);
  if (!user) return null;
  return (user.shares || [])
    .map((tid) => {
      const t = get(tid);
      if (!t) return null;
      const mutual = (t.shares || []).includes(id);
      return {
        id: t.id,
        name: t.name,
        photo: t.photo,
        mutual,
        socials: mutual ? t.socials : null, // hidden until they share back
      };
    })
    .filter(Boolean);
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
