// Photo moderation. Nothing here ever auto-approves: automated screening can
// only auto-REJECT or FLAG for human review. Every photo stays `pending` until
// an admin approves it, so a classifier's false negative can never publish a
// photo on its own.
//
// Provider is chosen with MODERATION_PROVIDER (default "none" = manual-only).
// To add automated screening later, implement a provider below with the same
// shape — callers never change.

export const PROVIDER = process.env.MODERATION_PROVIDER || "none";
export const MIN_AGE = 18;

// Deterministic rules that run for every submission regardless of provider.
// Returns { autoReject, reason, flags } — flags surface in the admin queue.
function baseRules(profile = {}) {
  const flags = [];
  const age = Number(profile.age);

  if (Number.isFinite(age) && age > 0 && age < MIN_AGE) {
    return { autoReject: true, reason: `declared age ${age} is under ${MIN_AGE}`, flags: ["underage-declared"] };
  }
  if (profile.confirmedAdult === false) {
    return { autoReject: true, reason: "did not confirm being 18 or older", flags: ["no-adult-confirmation"] };
  }

  if (!Number.isFinite(age) || !age) flags.push("no-age-given");
  else if (age < 21) flags.push("young-check-age");
  if (!profile.photo) flags.push("no-photo");
  return { autoReject: false, reason: null, flags };
}

// Provider hooks. Each returns { autoReject, reason, flags } or null.
// `none` — manual-only: the deterministic rules are the whole screen.
const providers = {
  none: () => null,
  // Stub: drop in nsfwjs (local model) here. It must only ever auto-reject
  // (explicit/porn class above threshold) or flag — never approve.
  nsfwjs: () => {
    throw new Error("MODERATION_PROVIDER=nsfwjs is not wired up yet; install nsfwjs and implement providers.nsfwjs");
  },
};

// Screen a submitted profile. Never returns "approved" — approval is human-only.
export function screen(profile = {}) {
  const base = baseRules(profile);
  if (base.autoReject) return base;
  const provider = providers[PROVIDER] || providers.none;
  const extra = provider(profile);
  if (!extra) return base;
  return {
    autoReject: !!extra.autoReject,
    reason: extra.reason || base.reason,
    flags: [...base.flags, ...(extra.flags || [])],
  };
}
