// Age / identity verification.
//
// This exists for one reason: a minor getting into the rating pool is the only
// risk on this site that ends in a criminal charge rather than a bill. Human
// review catches the obvious cases; verification catches the ones that look 22.
//
// There are two ways to run this. Pick with ID_PROVIDER.
//
// 1. "vendor" (safest) — the vendor holds the document, we receive only
//    pass/fail + an opaque reference:
//        user -> vendor (holds the document) -> we get {verified, reference}
//    What lands in users.json is a boolean, a date, a method, and a reference.
//    No image, no document number, no name, no date of birth.
//
// 2. "manual" — YOU review each ID by hand. This does hold the document, which
//    is the thing to be careful about: a database of passports is the single
//    most attractive target an attacker can find. So the manual path is built
//    to hold as little as possible for as short a time as possible:
//      - the ID is encrypted at rest with the same AES-256-GCM as photos;
//      - it is served ONLY to an admin, never through the public photo route;
//      - it is SHREDDED the instant you approve, reject or escalate.
//    So at any moment you hold only the IDs of people currently in your queue,
//    never a standing archive. Nothing from the ID is ever copied into
//    users.json — not the number, not the name, not the date of birth. Once you
//    have made the call, the document is gone.
//
// A NOTE ON FACE-BASED AGE ESTIMATION: several vendors offer cheap "age from a
// selfie" checks with no document. They are attractive and they are a trap for
// this app — analysing face geometry is exactly what triggers Illinois BIPA,
// which storing a plain photograph does not. If you enable a face-estimation
// provider you take on that exposure deliberately. Document-based checks don't.

export const PROVIDER = process.env.ID_PROVIDER || "none";

// "manual" means YOU review each ID by hand in the admin queue. The document is
// encrypted, shown only to an admin, and shredded the moment you decide — so you
// are never sitting on a database of IDs, only the handful currently in review.
// "vendor" hands the document to a third party who keeps it. "none" = off.
export const MODE = PROVIDER === "manual" ? "manual" : (PROVIDER !== "none" ? "vendor" : "none");
export const isManual = () => MODE === "manual";

// When on, an unverified profile's photo can never be approved, so it is never
// shown to anyone. Off by default so development and testing aren't blocked.
export const REQUIRED = process.env.REQUIRE_ID_VERIFICATION === "1";

export const MIN_AGE = 18;

export class VerificationError extends Error {}

// ---- provider interface ----
// start(profile, { returnUrl }) -> { url, reference }   redirect the user here
// resolve(reference)            -> { status, verified, method }
//   status: "pending" | "verified" | "failed" | "unsupported"
//
// Every provider must return ONLY these fields. If you implement one, resist
// passing the vendor's full response through — that's how document data ends up
// in the store by accident.

const providers = {
  // Development / manual-only: no vendor, an admin marks accounts verified by
  // hand from the review queue. Safe, free, and doesn't scale past small volume.
  none: {
    async start() {
      throw new VerificationError("No ID provider is configured (set ID_PROVIDER).");
    },
    async resolve() {
      return { status: "unsupported", verified: false, method: "none" };
    },
  },

  // Stripe Identity — the obvious first choice if you're already using Stripe
  // for credits: one vendor, one contract, document + liveness, and Stripe
  // holds the document rather than you.
  //
  // To implement: create a VerificationSession server-side with
  // POST https://api.stripe.com/v1/identity/verification_sessions
  // (type=document), redirect the user to session.url, then read the session
  // back here and map status "verified" -> verified. Store session.id as the
  // reference and NOTHING else from the response.
  stripe: {
    async start() {
      throw new VerificationError("ID_PROVIDER=stripe is not wired up yet — see the notes in src/identity.js");
    },
    async resolve() {
      return { status: "unsupported", verified: false, method: "stripe" };
    },
  },

  // Persona / Veriff / Jumio all follow the same hosted-flow shape: create an
  // inquiry, redirect, verify the webhook signature, read a terminal status.
  persona: {
    async start() {
      throw new VerificationError("ID_PROVIDER=persona is not wired up yet — see the notes in src/identity.js");
    },
    async resolve() {
      return { status: "unsupported", verified: false, method: "persona" };
    },
  },
};

const provider = () => providers[PROVIDER] || providers.none;

export const configured = () => MODE === "manual" || (PROVIDER !== "none" && !!providers[PROVIDER]);

export async function start(profile, opts = {}) {
  return provider().start(profile, opts);
}

export async function resolve(reference) {
  return provider().resolve(reference);
}

// The record we keep. Deliberately minimal — see the note at the top.
export function verificationRecord({ method, reference }) {
  return {
    verified: true,
    verifiedAt: new Date().toISOString(),
    method: String(method || PROVIDER).slice(0, 40), // "stripe" | "manual" | ...
    reference: reference ? String(reference).slice(0, 120) : null, // vendor id only
  };
}

// Can this profile's photo be shown to other people?
// Approval is still a human decision; this is an additional gate in front of it.
export function mayGoLive(profile) {
  if (!REQUIRED) return true;
  return !!profile?.identity?.verified;
}

// Why a profile is blocked, for the admin queue and the user's own banner.
export function blockedReason(profile) {
  if (!REQUIRED || profile?.identity?.verified) return null;
  if (MODE === "manual") {
    return profile?.idDoc ? "ID submitted — awaiting your review" : "no ID submitted — cannot verify age";
  }
  return configured()
    ? "age verification not completed"
    : "age verification required, but no provider is configured";
}
