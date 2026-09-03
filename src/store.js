// In-memory profile store with JSON file persistence.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { profileFromAnswers } from "./questions.js";
import { moralScore, moralAnswered, moralBreakdown, moralVerdict, worstVice, MORAL_QUESTIONS } from "./morality.js";
import { screen } from "./moderation.js";
import * as photos from "./photos.js";
import { urlFor } from "./phototokens.js";
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

// Profiles store a photo *id*; the bytes live encrypted in src/photos.js.
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
    photo: p.photo || null, // photo id (see src/photos.js), never image bytes
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
    moralAnswers: p.moralAnswers || {}, // the morality quiz — separate bank
    natureScore: moralScore(p.moralAnswers || {}), // Human Nature score: -72..+72
    moralAnswered: moralAnswered(p.moralAnswers || {}),
    confirmedAdult: p.confirmedAdult !== false, // ticked the "I am 18 or older" box
    // Moderation: a photo is never visible to others until an admin approves it.
    photoStatus: "pending", // pending | approved | rejected
    moderation: { flags: [], reason: null, reviewedBy: null, reviewedAt: null },
    photoSubmittedAt: new Date().toISOString(),
    accountLocked: false, // set by an admin "escalate" — blocks re-uploading
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
  applyScreen(user);
  users.push(user);
  persist();
  return user;
}

// Run automated screening and store its verdict. Screening can only reject or
// flag — approval always requires an admin.
function applyScreen(user) {
  const verdict = screen(user);
  user.moderation = {
    flags: verdict.flags || [],
    reason: verdict.reason || null,
    reviewedBy: null,
    reviewedAt: null,
  };
  user.photoStatus = verdict.autoReject ? "rejected" : "pending";
  if (verdict.autoReject) user.moderation.reviewedBy = "auto";
  return user;
}

// An admin decision on a photo: approve | reject | escalate (reject + lock).
export function moderatePhoto(id, action, reason, adminEmail) {
  const user = get(id);
  if (!user) return null;
  const mod = user.moderation || (user.moderation = { flags: [], reason: null });
  mod.reason = reason ? String(reason).slice(0, 300) : null;
  mod.reviewedBy = adminEmail || "admin";
  mod.reviewedAt = new Date().toISOString();
  if (action === "approve") {
    user.photoStatus = "approved";
    user.accountLocked = false;
  } else {
    user.photoStatus = "rejected";
    user.accountLocked = action === "escalate";
    // A rejected photo is deleted, not merely hidden. Keeping it would mean
    // storing images a reviewer has already judged unacceptable.
    if (user.photo) { photos.remove(user.photo); user.photo = null; }
  }
  persist();
  return user;
}

// Profiles awaiting review, oldest first, plus recently decided ones.
export function moderationQueue({ limit = 50 } = {}) {
  const byTime = (a, b) => String(a.photoSubmittedAt).localeCompare(String(b.photoSubmittedAt));
  return {
    pending: users.filter((u) => u.photoStatus === "pending").sort(byTime).slice(0, limit),
    decided: users
      .filter((u) => u.photoStatus !== "pending" && u.moderation?.reviewedAt)
      .sort((a, b) => String(b.moderation.reviewedAt).localeCompare(String(a.moderation.reviewedAt)))
      .slice(0, limit),
  };
}

// Only approved photos are ever shown to other users.
export function visible() {
  return users.filter((u) => u.photoStatus === "approved");
}

export function update(id, p = {}) {
  const user = get(id);
  if (!user) return null;
  if (user.accountLocked) return user; // escalated accounts can't re-submit
  if (p.name != null) user.name = String(p.name).slice(0, 80);
  let photoChanged = false;
  if (p.photo != null) {
    const next = p.photo || null;
    photoChanged = next !== user.photo;
    // Replacing a photo shreds the old blob rather than orphaning it on disk.
    if (photoChanged && user.photo) photos.remove(user.photo);
    user.photo = next;
  }
  if (p.age != null) user.age = Number(p.age) || null;
  if (p.confirmedAdult != null) user.confirmedAdult = !!p.confirmedAdult;
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
  if (p.moralAnswers != null) {
    user.moralAnswers = { ...(user.moralAnswers || {}), ...p.moralAnswers };
    user.natureScore = moralScore(user.moralAnswers);
    user.moralAnswered = moralAnswered(user.moralAnswers);
  }
  // A new photo (or a new age claim) invalidates any prior approval.
  if (photoChanged || p.age != null) {
    user.photoSubmittedAt = new Date().toISOString();
    applyScreen(user);
  }
  persist();
  return user;
}

// Merge a single answer from either question bank and recompute what it feeds:
// the taste bank drives the trait vector, the morality bank drives the score.
export function setAnswer(id, qid, optionIndex, bank = "traits") {
  const user = get(id);
  if (!user) return null;
  if (bank === "moral") {
    user.moralAnswers = { ...(user.moralAnswers || {}), [qid]: Number(optionIndex) };
    user.natureScore = moralScore(user.moralAnswers);
    user.moralAnswered = moralAnswered(user.moralAnswers);
  } else {
    user.answers = { ...(user.answers || {}), [qid]: Number(optionIndex) };
    user.traits = profileFromAnswers(user.answers);
  }
  persist();
  return user;
}

export function remove(id) {
  const before = users.length;
  const user = get(id);
  if (user?.photo) photos.remove(user.photo);
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
export function matchView(u, viewerId) {
  if (!u) return null;
  return { id: u.id, name: u.name, photoUrl: urlFor(u.photo, viewerId), age: u.age, gender: u.gender, socials: u.socials, natureScore: u.natureScore || 0 };
}

// The morality report for a profile owner: score, verdict, per-vice breakdown.
export function moralReport(u) {
  const answers = u?.moralAnswers || {};
  return {
    score: u?.natureScore || 0,
    answered: u?.moralAnswered || 0,
    total: MORAL_QUESTIONS.length,
    complete: (u?.moralAnswered || 0) >= MORAL_QUESTIONS.length,
    verdict: moralVerdict(u?.natureScore || 0),
    breakdown: moralBreakdown(answers),
    worst: (u?.moralAnswered || 0) ? worstVice(answers) : null,
  };
}

export function save() {
  persist();
}

// Public shape — never leaks answers, accumulators, or socials.
export function publicView(u, viewerId) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    // A short-lived URL bound to this viewer — never the photo id or its bytes.
    photoUrl: urlFor(u.photo, viewerId),
    age: u.age,
    gender: u.gender,
    orientation: u.orientation,
    elo: Math.round(u.elo),
    matchups: u.matchups || 0,
    credits: u.credits || 0,
    votesCast: u.votesCast || 0,
    photoStatus: u.photoStatus || "pending",
    natureScore: u.natureScore || 0,
    moralAnswered: u.moralAnswered || 0,
  };
}

// The owner's own view: adds the moderation verdict and score breakdown.
export function ownerView(u, viewerId) {
  if (!u) return null;
  return {
    ...publicView(u, viewerId),
    hasPhoto: !!u.photo,
    accountLocked: !!u.accountLocked,
    moderation: {
      flags: u.moderation?.flags || [],
      reason: u.moderation?.reason || null,
      reviewedAt: u.moderation?.reviewedAt || null,
    },
    moralAnswered: u.moralAnswered || 0,
    moralTotal: MORAL_QUESTIONS.length,
  };
}

// Admin queue view: everything a reviewer needs to judge a photo.
export function adminView(u, viewerId) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    photoUrl: urlFor(u.photo, viewerId),
    age: u.age,
    gender: u.gender,
    genderIdentity: u.genderIdentity,
    photoStatus: u.photoStatus || "pending",
    photoSubmittedAt: u.photoSubmittedAt || u.createdAt,
    accountLocked: !!u.accountLocked,
    moderation: u.moderation || { flags: [], reason: null },
    createdAt: u.createdAt,
  };
}
