// Request throttling for the endpoints an attacker hits in bulk.
//
// Same fixed-window approach as the photo scrape budget in src/phototokens.js —
// in memory, no dependency, and honest about what that means: state is per
// process and resets on restart. That's fine for what this is for. It raises
// the cost of a script from "free and instant" to "slow and logged", which is
// the whole goal; it is not a defence against a distributed attack, and nothing
// you can build at this layer is.
//
// WHY LOGIN NEEDS THIS HERE SPECIFICALLY: this site publishes a leaderboard of
// faces. That makes an individual account a target in a way an ordinary app's
// isn't — someone who wants into a particular person's account knows exactly
// which email to grind. Unlimited guesses is the gap that makes that work.

const buckets = new Map(); // key -> { count, resetAt }

// Count one hit against `key`. Returns true while it's under the limit.
export function hit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count <= limit;
}

export function clear(key) {
  buckets.delete(key);
}

// How long until this key's window resets, in whole seconds — for Retry-After.
export function retryAfter(key) {
  const b = buckets.get(key);
  if (!b) return 0;
  return Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000));
}

// Express middleware: a fixed number of requests per window, keyed by IP plus
// whatever else the caller wants to separate on.
export function limit({ name, max, windowMs, keyOf, message }) {
  return (req, res, next) => {
    if (disabled()) return next();
    const key = `${name}:${keyOf ? keyOf(req) : ""}:${req.ip || req.socket?.remoteAddress || "?"}`;
    if (hit(key, max, windowMs)) return next();
    res.set("Retry-After", String(retryAfter(key)));
    res.status(429).json({ error: message || "too many requests — wait a minute and try again" });
  };
}

// Tests hammer these endpoints on purpose; a limiter would make them flaky and
// prove nothing, so it's off under NODE_ENV=test unless a test asks for it.
// Read per request, not at import, so a test can switch it on for one case.
const disabled = () => process.env.NODE_ENV === "test" && process.env.THROTTLE_IN_TEST !== "1";

// Failed logins only. A correct password clears the counter (see the route), so
// a person who mistypes twice and then succeeds is never locked out — only a
// run of failures counts, which is what a guessing attack looks like.
export const LOGIN = { max: 10, windowMs: 15 * 60 * 1000 };
// Signups are the cheapest way to manufacture voters, and a voter's whole
// purpose is to be a countable, distinct person.
export const SIGNUP = { max: 8, windowMs: 60 * 60 * 1000 };
// Reports hide a photo instantly, before a human looks. That's the right call
// for a real NCII report and a griefing tool without a ceiling on it.
export const REPORT = { max: 15, windowMs: 60 * 60 * 1000 };

export function _reset() {
  buckets.clear();
}
