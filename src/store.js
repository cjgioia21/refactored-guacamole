// In-memory profile store with JSON file persistence.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { profileFromAnswers } from "./questions.js";
import { moralScore, moralAnswered, moralBreakdown, moralVerdict, worstVice, MORAL_QUESTIONS } from "./morality.js";
import { screen } from "./moderation.js";
import * as photos from "./photos.js";
import * as identity from "./identity.js";
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
    shareName: !!p.shareName, // reveal your name to matches? off unless you say so
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
    wins: 0, // matchups won — the raw fact behind the win rate
    losses: 0, // matchups lost
    deathVotes: { saved: 0, left: 0 }, // "you can only save one"
    cheatVotes: { yes: 0, no: 0 }, // "would you cheat for this person"
    // Age/ID verification. A pass/fail plus a vendor reference — never the
    // document itself. See the note at the top of src/identity.js.
    identity: { verified: false, verifiedAt: null, method: null, reference: null },
    idDoc: p.idDoc || null, // encrypted ID document id, for manual review — shredded on decision
    idSubmittedAt: p.idDoc ? new Date().toISOString() : null,
    idRequested: false, // an admin asked this person for ID before approving
    revealed: {}, // { gameKey: true } trait reveals you've purchased
    fansUnlocked: false, // "Who Likes You?" demographic report unlocked
    emailOnNewData: false,
    lastDataEmailAt: null, // throttles the "new data" email — see dueForDataEmail
    matchupsAtLastEmail: 0,
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
    // If a reviewer asked this person for ID, approving before it arrives would
    // silently undo that decision — usually a misclick. Refuse.
    if (user.idRequested && !user.idDoc) {
      mod.reason = "age check requested — waiting on their ID";
      return user;
    }
    // Approving after an ID check IS the age confirmation. We record that it
    // happened and nothing from the document itself.
    if (user.idDoc && !user.identity?.verified) {
      user.identity = identity.verificationRecord({ method: "manual-id", reference: `admin:${adminEmail}` });
    } else if (!identity.mayGoLive(user)) {
      mod.reason = identity.blockedReason(user);
      return user; // only reachable when REQUIRE_ID_VERIFICATION forces it
    }
    user.photoStatus = "approved";
    user.accountLocked = false;
  } else {
    user.photoStatus = "rejected";
    user.accountLocked = action === "escalate";
    // A rejected photo is deleted, not merely hidden. Keeping it would mean
    // storing images a reviewer has already judged unacceptable.
    if (user.photo) { photos.remove(user.photo); user.photo = null; }
  }
  // Shred the ID on every decision — its only job was this review. See the note
  // at the top of src/identity.js: we never keep a standing archive of IDs.
  if (user.idDoc) { photos.remove(user.idDoc); user.idDoc = null; }
  user.idRequested = false;
  persist();
  return user;
}

// The encrypted ID-document id for a profile, for admin-only serving. Never
// exposed to anyone but an admin, and never through the public photo route.
export function idDocOf(id) {
  return get(id)?.idDoc || null;
}

// Profiles awaiting review, oldest first, plus recently decided ones.
export function moderationQueue({ limit = 50 } = {}) {
  const byTime = (a, b) => String(a.photoSubmittedAt).localeCompare(String(b.photoSubmittedAt));
  return {
    // A voter has no photo, so there is nothing to review — only profiles that
    // actually submitted an image belong in the queue.
    pending: users.filter((u) => u.photoStatus === "pending" && u.photo).sort(byTime).slice(0, limit),
    decided: users
      .filter((u) => u.photoStatus !== "pending" && u.moderation?.reviewedAt)
      .sort((a, b) => String(b.moderation.reviewedAt).localeCompare(String(a.moderation.reviewedAt)))
      .slice(0, limit),
  };
}

// Take a photo out of circulation immediately, before any human looks at it.
// Used by urgent reports: an unfounded report costs someone a few hours; the
// other way round is not recoverable.
export function suspendPhoto(id, reason) {
  const user = get(id);
  if (!user) return null;
  user.photoStatus = "pending";
  user.moderation = {
    ...(user.moderation || { flags: [] }),
    flags: [...new Set([...(user.moderation?.flags || []), "reported"])],
    reason: reason ? String(reason).slice(0, 300) : "reported — awaiting review",
    reviewedBy: null,
    reviewedAt: null,
  };
  persist();
  return user;
}

// Record a completed verification. Takes only what src/identity.js allows out.
export function setVerified(id, record) {
  const user = get(id);
  if (!user) return null;
  user.identity = record;
  persist();
  return user;
}

// Ask this person for ID before their photo can be approved. Used when a
// reviewer isn't confident about their age — the escalation that means we hold
// IDs only for the people we were unsure about, never for everyone.
export function requestId(id, adminEmail) {
  const user = get(id);
  if (!user) return null;
  user.idRequested = true;
  user.photoStatus = "pending";
  user.moderation = {
    ...(user.moderation || { flags: [] }),
    flags: [...new Set([...(user.moderation?.flags || []), "age-check"])],
    reason: "age check requested — please send a photo holding your ID",
    reviewedBy: adminEmail || "admin",
    reviewedAt: new Date().toISOString(),
  };
  persist();
  return user;
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
  if (p.shareName != null) user.shareName = !!p.shareName;
  if (p.idDoc != null) {
    if (user.idDoc && user.idDoc !== p.idDoc) photos.remove(user.idDoc);
    user.idDoc = p.idDoc || null;
    user.idSubmittedAt = p.idDoc ? new Date().toISOString() : null;
  }
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
  if (user?.idDoc) photos.remove(user.idDoc);
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

// Record a dilemma vote about a target. These are preference votes with no
// right answer, so they never touch the guessing accuracy stats.
export function recordDilemma(targetId, kind, choice) {
  const target = get(targetId);
  if (!target) return null;
  if (kind === "death" && (choice === "saved" || choice === "left")) {
    const d = target.deathVotes || (target.deathVotes = { saved: 0, left: 0 });
    d[choice] += 1;
  } else if (kind === "cheat" && (choice === "yes" || choice === "no")) {
    const c = target.cheatVotes || (target.cheatVotes = { yes: 0, no: 0 });
    c[choice] += 1;
  } else {
    return null;
  }
  persist();
  return target;
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
// Should this person be told there's new data in their report? True at most
// once a day, and only after enough new matchups that there's actually
// something to look at — a notification that fires on every vote is spam, and
// spam is how a sending domain gets blocked.
const DATA_EMAIL_MIN_NEW = 25;
const DATA_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export function dueForDataEmail(id) {
  const user = get(id);
  if (!user?.emailOnNewData) return false;
  const since = (user.matchups || 0) - (user.matchupsAtLastEmail || 0);
  if (since < DATA_EMAIL_MIN_NEW) return false;
  const last = user.lastDataEmailAt ? Date.parse(user.lastDataEmailAt) : 0;
  return Date.now() - last >= DATA_EMAIL_COOLDOWN_MS;
}
// Record that we sent one, so the next is a day and 25 matchups away.
export function markDataEmailSent(id) {
  const user = get(id);
  if (!user) return;
  user.lastDataEmailAt = new Date().toISOString();
  user.matchupsAtLastEmail = user.matchups || 0;
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

// Participant card: the shape used on the Top 10 and anywhere a participant is
// shown as a person rather than as an anonymous face to rate. Carries the
// socials they chose to link; carries a name only if they opted into that.
//
// Deliberately NOT used in the rating pool — see publicView. A handle under a
// face changes the vote, and every number here depends on the vote being about
// the face alone.
export function participantView(u, viewerId) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.shareName ? u.name : null,
    photoUrl: urlFor(u.photo, viewerId),
    age: u.age,
    gender: u.gender,
    socials: u.socials || {},
  };
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
    // No name. The rating pool is anonymous: a face, an age, nothing else.
    // A first initial is an identifier too, so there is no fallback either.
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
    name: u.name, // your own name, for the profile form
    shareName: !!u.shareName,
    hasPhoto: !!u.photo,
    isParticipant: u.photoStatus === "approved",
    idRequested: !!u.idRequested,
    hasId: !!u.idDoc,
    verified: !!u.identity?.verified,
    verificationRequired: identity.REQUIRED,
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
    name: u.name, // reviewers see names; the privacy policy says so plainly
    photoUrl: urlFor(u.photo, viewerId),
    age: u.age,
    gender: u.gender,
    genderIdentity: u.genderIdentity,
    photoStatus: u.photoStatus || "pending",
    photoSubmittedAt: u.photoSubmittedAt || u.createdAt,
    verified: !!u.identity?.verified,
    verifiedAt: u.identity?.verifiedAt || null,
    verificationMethod: u.identity?.method || null,
    mayGoLive: identity.mayGoLive(u),
    hasId: !!u.idDoc,
    idRequested: !!u.idRequested,
    idSubmittedAt: u.idSubmittedAt || null,
    idReviewMode: identity.MODE,
    accountLocked: !!u.accountLocked,
    moderation: u.moderation || { flags: [], reason: null },
    createdAt: u.createdAt,
  };
}
