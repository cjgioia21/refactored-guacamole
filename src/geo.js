// Regional restrictions.
//
// TrueHumanNature collects political opinions, sexual history, sexual
// orientation and mental-health data, and it stores face photographs. Two
// regimes make that unusually expensive to get wrong:
//
//   - EU/UK: all four are "special category" data under GDPR Article 9.
//   - Illinois: BIPA treats face images as biometric identifiers, with
//     statutory damages per person per violation and no cure period.
//
// So we don't operate there. This module is the enforcement.
//
// HONEST LIMITS, because a blocklist that looks stronger than it is, is worse
// than none:
//   1. Country detection needs a trusted upstream header. Cloudflare's free
//      CF-IPCountry is the intended source (put Cloudflare in front of nginx).
//      With no such header we cannot determine country and we FAIL OPEN, since
//      failing closed would lock everyone out the day a proxy config changes.
//   2. Free country headers do not give US state. Illinois is therefore
//      enforced by a required state selector at signup plus the Terms, unless
//      you configure a real geo-IP database. Self-declaration is weak: someone
//      who wants past it will get past it. It is a good-faith control and a
//      contractual one, not a technical guarantee.
//   3. A VPN defeats all of this. That is true of every geo-block on the web.

// Comma-separated ISO country codes. Default: EU/EEA + UK.
const DEFAULT_BLOCKED = [
  // EU member states
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA
  "IS", "LI", "NO",
  // United Kingdom
  "GB",
];

export const BLOCKED_COUNTRIES = new Set(
  (process.env.BLOCKED_COUNTRIES || DEFAULT_BLOCKED.join(","))
    .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
);

export const BLOCKED_STATES = new Set(
  (process.env.BLOCKED_US_STATES || "IL").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
);

// US states, for the signup selector. Blocked ones are still listed so someone
// in Illinois gets an honest "we can't serve you" rather than a silent absence.
export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

// Country from an upstream edge header. Cloudflare sets CF-IPCountry on every
// plan; the others are here so a different proxy works without code changes.
export function countryOf(req) {
  const raw =
    req.get("cf-ipcountry") ||
    req.get("x-vercel-ip-country") ||
    req.get("x-country-code") ||
    req.get("fastly-client-country") ||
    "";
  const code = raw.trim().toUpperCase();
  // "XX"/"T1" mean unknown or Tor. Treat as unknown rather than as a country.
  if (!code || code === "XX" || code === "T1") return null;
  return code;
}

// State from an edge header, when one is available (Cloudflare Enterprise,
// or a proxy you configure). Usually null — see the honest limits above.
export function stateOf(req) {
  const raw = req.get("cf-region-code") || req.get("x-vercel-ip-country-region") || req.get("x-region-code") || "";
  const code = raw.trim().toUpperCase();
  return code || null;
}

export function isBlockedCountry(code) {
  return !!code && BLOCKED_COUNTRIES.has(code);
}
export function isBlockedState(code) {
  return !!code && BLOCKED_STATES.has(code);
}

// Reject a signup whose declared region we don't serve. Returns an error
// message, or null when the region is acceptable.
export function checkSignupRegion({ country, state }) {
  if (isBlockedCountry(country)) {
    return "TrueHumanNature isn't available in your region.";
  }
  if (country === "US" && !state) {
    return "Please select your state.";
  }
  if (country === "US" && isBlockedState(state)) {
    return "TrueHumanNature isn't available in Illinois.";
  }
  return null;
}

// Express middleware. Blocks requests from restricted countries with a plain
// explanation rather than a bare 403, and exposes req.geo to later handlers.
export function geoGate(req, res, next) {
  const country = countryOf(req);
  const state = stateOf(req);
  req.geo = { country, state };

  if (isBlockedCountry(country) || (country === "US" && isBlockedState(state))) {
    // Let the block page and static assets through so the explanation renders.
    if (req.path === "/unavailable" || req.path.startsWith("/style.css")) return next();
    if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
      return res.status(451).json({ error: "unavailable in your region", region: country });
    }
    return res.redirect(302, "/unavailable");
  }
  next();
}

// The page a blocked visitor sees. Says why, because "403" tells them nothing.
export const unavailableHtml = () => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Not available in your region — TrueHumanNature</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
    background:#12121a; color:#f2f2f7; font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:520px; }
  h1 { font-size:28px; margin:0 0 16px; letter-spacing:-.02em; }
  p { color:#b9b9c6; }
  a { color:#a58bff; }
</style></head>
<body><main>
  <h1>We can't serve you here</h1>
  <p>TrueHumanNature isn't available in the European Union, the United Kingdom,
     or the State of Illinois.</p>
  <p>This site collects information that those regions regulate especially
     strictly — political views, sexual history, health information, and
     photographs of your face. Rather than handle that badly, we've chosen not
     to operate there.</p>
  <p>If you think you're seeing this in error, get in touch.</p>
</main></body></html>`;
