// Authentication: email/password accounts, signed-cookie sessions, and an
// optional Google OAuth flow. No external dependencies — hashing and cookie
// signing use node:crypto.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { dataFile } from "./paths.js";

const ACCOUNTS_FILE = dataFile("accounts.json");
const SECRET_FILE = dataFile(".secret");
const COOKIE = "sm_session";
const SESSION_DAYS = 30;
const SECURE_COOKIES = process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1";

let accounts = load();
// A stable secret keeps sessions valid across restarts. Prefer an env var
// (best for multi-instance / ephemeral disks), then a persisted file.
const SECRET = process.env.SESSION_SECRET || loadSecret();

function load() {
  try {
    if (existsSync(ACCOUNTS_FILE)) return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch {
    /* ignore */
  }
  return [];
}
function persist() {
  try {
    writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  } catch {
    /* best-effort */
  }
}
// Stable server secret so sessions survive restarts.
function loadSecret() {
  try {
    if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
    const s = randomBytes(32).toString("hex");
    writeFileSync(SECRET_FILE, s);
    return s;
  } catch {
    return randomBytes(32).toString("hex"); // ephemeral fallback
  }
}

// --- password hashing (scrypt) ---
function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const test = scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, "hex");
  return test.length === known.length && timingSafeEqual(test, known);
}

// --- signed cookie sessions ---
function sign(value) {
  const sig = createHmac("sha256", SECRET).update(value).digest("base64url");
  return `${value}.${sig}`;
}
function unsign(signed) {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const expected = createHmac("sha256", SECRET).update(value).digest("base64url");
  const got = signed.slice(i + 1);
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? value : null;
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
function setSession(res, accountId) {
  const token = sign(`${accountId}|${Date.now()}`);
  const secure = SECURE_COOKIES ? "; Secure" : "";
  res.setHeader("Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${secure}`);
}
function clearSession(res) {
  const secure = SECURE_COOKIES ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}

// --- accounts ---
export function accountById(id) {
  return accounts.find((a) => a.id === id) || null;
}
function byEmail(email) {
  return accounts.find((a) => a.email === String(email).toLowerCase()) || null;
}

export function signup(email, password) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "invalid email" };
  if (String(password || "").length < 6) return { error: "password too short (min 6)" };
  if (byEmail(email)) return { error: "email already registered" };
  const account = {
    id: randomUUID(), email, passwordHash: hashPassword(password), googleId: null, profileId: null,
    agreements: {}, // { terms: {version, acceptedAt, ip}, ... } — see src/legal.js
    region: null, // { country, state } captured at signup for the regional rules
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  persist();
  return { account };
}

export function login(email, password) {
  const account = byEmail(String(email || "").trim().toLowerCase());
  if (!account || !verifyPassword(password, account.passwordHash)) return { error: "invalid credentials" };
  return { account };
}

// Upsert an account from a verified Google profile.
export function upsertGoogle({ googleId, email }) {
  let account = accounts.find((a) => a.googleId === googleId) || byEmail(email);
  if (!account) {
    account = { id: randomUUID(), email: String(email || "").toLowerCase(), passwordHash: null, googleId, profileId: null, createdAt: new Date().toISOString() };
    accounts.push(account);
  } else if (!account.googleId) {
    account.googleId = googleId;
  }
  persist();
  return account;
}

export function linkProfile(accountId, profileId) {
  const a = accountById(accountId);
  if (a) { a.profileId = profileId; persist(); }
  return a;
}

// Resolve the account for a request from its session cookie.
export function currentAccount(req) {
  const raw = parseCookies(req)[COOKIE];
  const value = unsign(raw);
  if (!value) return null;
  const [accountId] = value.split("|");
  return accountById(accountId);
}

// Express helpers
export function issueSession(res, accountId) { setSession(res, accountId); }
export function endSession(res) { clearSession(res); }

// Middleware: attaches req.account or 401s.
export function requireAuth(req, res, next) {
  const account = currentAccount(req);
  if (!account) return res.status(401).json({ error: "not authenticated" });
  req.account = account;
  next();
}

// --- Google OAuth (dormant until env vars are set) ---
export const googleConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.OAUTH_REDIRECT);

export function googleAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.OAUTH_REDIRECT,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// Exchange an auth code for the user's Google identity.
export async function googleExchange(code) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.OAUTH_REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const token = await tokenRes.json();
  if (!token.access_token) throw new Error("google token exchange failed");
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const info = await infoRes.json();
  return { googleId: info.sub, email: info.email };
}

export function publicAccount(a) {
  return a ? { id: a.id, email: a.email, profileId: a.profileId, google: !!a.googleId, agreements: a.agreements || {} } : null;
}

// Store an acceptance record against the account (see src/legal.js).
export function recordAgreement(accountId, key, record) {
  const a = accountById(accountId);
  if (!a) return null;
  a.agreements = { ...(a.agreements || {}), [key]: record };
  persist();
  return a;
}

// Where the account signed up from, used to enforce the regional restrictions.
export function setRegion(accountId, region) {
  const a = accountById(accountId);
  if (!a) return null;
  a.region = region;
  persist();
  return a;
}
