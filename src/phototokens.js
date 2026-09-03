// Short-lived, per-viewer photo URLs.
//
// The problem this solves is the one that actually happens to a site like this:
// a photo URL gets shared, posted, or scraped, and it keeps working forever for
// anyone who has it. Encryption at rest does nothing about that.
//
// So there is no stable URL. Every photo link carries an HMAC over
// (photoId, viewerAccountId, expiry). It stops working in minutes, and it does
// not work at all in anybody else's session. A link pasted into a group chat is
// dead on arrival.
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dataFile } from "./paths.js";

export const TOKEN_TTL_MS = 10 * 60 * 1000; // a link is good for ten minutes

// Reuses the same secret-loading approach as sessions in src/auth.js.
const SECRET_FILE = dataFile(".photosecret");
const SECRET = process.env.PHOTO_URL_SECRET || process.env.SESSION_SECRET || loadSecret();

function loadSecret() {
  try {
    if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
    const s = randomBytes(32).toString("hex");
    writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  } catch {
    return randomBytes(32).toString("hex");
  }
}

const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (payload) => createHmac("sha256", SECRET).update(payload).digest("base64url");

// Mint a token binding one photo to one viewer for a short window.
export function mint(photoId, viewerId, ttl = TOKEN_TTL_MS) {
  const exp = Date.now() + ttl;
  const payload = `${photoId}.${viewerId || "anon"}.${exp}`;
  return `${b64(payload)}.${sign(payload)}`;
}

// The URL the client actually renders. Returns null when there's no photo, so
// the caller falls back to an initial-letter avatar.
export function urlFor(photoId, viewerId) {
  if (!photoId) return null;
  return `/photos/${photoId}?t=${mint(photoId, viewerId)}`;
}

// Verify a token against the photo being requested and the session asking for
// it. Every failure mode is deliberately indistinguishable to the caller.
export function verify(token, photoId, viewerId) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const i = token.lastIndexOf(".");
  const encoded = token.slice(0, i);
  const mac = token.slice(i + 1);
  let payload;
  try {
    payload = Buffer.from(encoded, "base64url").toString();
  } catch {
    return false;
  }
  const expected = sign(payload);
  // Constant-time compare so the MAC can't be guessed a byte at a time.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const [tokenPhoto, tokenViewer, exp] = payload.split(".");
  if (tokenPhoto !== photoId) return false;
  if (tokenViewer !== (viewerId || "anon")) return false;
  return Number(exp) > Date.now();
}

// ---- scrape budget ----
// Encryption and signed URLs don't stop a logged-in account from walking the
// matchup endpoint and pulling every photo. A per-account budget does: it keeps
// normal rating (a few hundred photos an hour) comfortable while making bulk
// collection slow and, more importantly, visible in the logs.
export const HOURLY_BUDGET = Number(process.env.PHOTO_HOURLY_BUDGET || 400);
const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map(); // accountId -> { count, resetAt, flagged }

export function spendBudget(accountId, n = 1) {
  const key = accountId || "anon";
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS, flagged: false };
    buckets.set(key, b);
  }
  b.count += n;
  if (b.count > HOURLY_BUDGET) {
    if (!b.flagged) {
      b.flagged = true;
      console.warn(`[photos] account ${key} exceeded the hourly photo budget (${HOURLY_BUDGET}) — possible scraping`);
    }
    return false;
  }
  return true;
}

export function budgetState(accountId) {
  const b = buckets.get(accountId || "anon");
  if (!b || Date.now() >= b.resetAt) return { used: 0, limit: HOURLY_BUDGET };
  return { used: b.count, limit: HOURLY_BUDGET };
}

// Test/ops hook: drop all budget state.
export function resetBudgets() {
  buckets.clear();
}
