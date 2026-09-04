// A record of every completed purchase, keyed by Stripe checkout session id.
//
// Its whole job is idempotency. Stripe retries a webhook until it gets a 2xx —
// on a timeout, a deploy, a slow write — so the same completed checkout can
// arrive several times. Without this, each retry grants the credits again.
//
// It doubles as the receipt log: if someone says they paid and got nothing,
// this is the file that answers.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dataFile } from "./paths.js";

const FILE = dataFile("purchases.json");

let purchases = load();

function load() {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    /* corrupt/missing -> start clean */
  }
  return [];
}

function persist() {
  try {
    writeFileSync(FILE, JSON.stringify(purchases, null, 2));
  } catch {
    /* best-effort */
  }
}

export const seen = (sessionId) => purchases.some((p) => p.sessionId === sessionId);

// Record a grant. Returns false if this session was already credited, which is
// the caller's signal to do nothing and still answer 200 so Stripe stops
// retrying a request that succeeded the first time.
export function record({ sessionId, profileId, credits, packId }) {
  if (!sessionId || seen(sessionId)) return false;
  purchases.push({ sessionId, profileId, credits, packId, at: new Date().toISOString() });
  persist();
  return true;
}

export const all = () => purchases;
export const forProfile = (profileId) => purchases.filter((p) => p.profileId === profileId);

// Test hook.
export function _reset() {
  purchases = [];
  persist();
}
