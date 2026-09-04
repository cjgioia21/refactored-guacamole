// Outbound email.
//
// Ships DORMANT on purpose. With no MAIL_PROVIDER set, every send is written to
// the console and reported as not sent — so the password-reset and alerting
// paths are fully exercised in development without a provider account, and
// turning mail on later is two environment variables rather than a code change.
// Same shape as the Google OAuth flow in src/auth.js, which is also inert until
// it's configured.
//
// TWO RULES, because both are load-bearing:
//
//   1. A send NEVER throws into a request path. Mail is a side effect of
//      signing up, filing a report, or asking for a reset — none of which
//      should fail because a third-party API is having an afternoon. Every
//      call returns {sent, reason} and swallows its own errors.
//
//   2. We never put anything into an email that we wouldn't want sitting in an
//      inbox forever, on a mail server we don't run. No photos, no photo links,
//      no questionnaire answers, no scores about a named person. Reset links
//      and the fact that something needs your attention — that's the whole
//      surface.

const PROVIDER = process.env.MAIL_PROVIDER || "none";
export const FROM = process.env.MAIL_FROM || "TrueHumanNature <no-reply@truehumannature.com>";
// Used to build absolute links (password resets). Without it a reset email
// would carry a relative path, which is useless in a mail client.
export const BASE_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");

export const configured = () => PROVIDER !== "none";

const providers = {
  // Development and pre-launch: log it, don't send it. Returning sent:false is
  // deliberate — a caller must never be able to mistake this for delivery.
  none: async ({ to, subject, text }) => {
    console.log(`\n[mail] would send to ${to}\n[mail] subject: ${subject}\n${String(text).split("\n").map((l) => `[mail] | ${l}`).join("\n")}\n`);
    return { sent: false, reason: "no provider configured (MAIL_PROVIDER)" };
  },

  // Resend. Plain HTTPS, no SDK and no dependency — set MAIL_PROVIDER=resend
  // and RESEND_API_KEY, and verify your sending domain with them first or
  // everything lands in spam.
  resend: async ({ to, subject, text }) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { sent: false, reason: "RESEND_API_KEY is not set" };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!res.ok) return { sent: false, reason: `resend ${res.status}` };
    return { sent: true };
  },
};

// Send one message. Never throws.
export async function send({ to, subject, text }) {
  if (!to || !subject) return { sent: false, reason: "missing recipient or subject" };
  const impl = providers[PROVIDER] || providers.none;
  try {
    return await impl({ to, subject, text: text || "" });
  } catch (err) {
    // A mail outage is not a request failure. Log it and carry on.
    console.warn(`[mail] send failed: ${err?.message || err}`);
    return { sent: false, reason: "send failed" };
  }
}

// Send the same message to every admin. Used for things you need to see within
// hours, not whenever you next open the dashboard.
export async function alertAdmins({ subject, text }) {
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!admins.length) return { sent: false, reason: "ADMIN_EMAILS is not set" };
  const results = await Promise.all(admins.map((to) => send({ to, subject, text })));
  return { sent: results.some((r) => r.sent), count: results.filter((r) => r.sent).length };
}

// ---- the messages themselves ----
// Kept here so the wording is in one place and the routes stay about routing.

export const resetEmail = (token) => ({
  subject: "Reset your TrueHumanNature password",
  text: [
    "Someone asked to reset the password on this address.",
    "",
    BASE_URL ? `${BASE_URL}/?reset=${token}` : `Reset code: ${token}`,
    "",
    "The link works once and expires in 30 minutes.",
    "If this wasn't you, ignore this email — nothing has changed, and nobody",
    "can get into the account with this message alone.",
  ].join("\n"),
});

export const urgentReportEmail = (report, reasonLabel) => ({
  subject: `[TrueHumanNature] Urgent report: ${reasonLabel}`,
  text: [
    `A report was filed under "${reasonLabel}".`,
    "",
    `Report id: ${report.id}`,
    `Filed at:  ${report.createdAt}`,
    "",
    "The photo is already hidden from everyone — that happened automatically",
    "when the report was filed. It stays hidden until you decide.",
    "",
    "Review it in the admin queue. The Terms commit you to removing confirmed",
    "cases within 24 hours, so this one is on the clock.",
    "",
    "No photo, name or detail is included in this email on purpose.",
  ].join("\n"),
});

export const photoDecisionEmail = (approved, reason) => ({
  subject: approved ? "Your photo is live on TrueHumanNature" : "Your photo wasn't approved",
  text: approved
    ? [
        "A reviewer approved your photo. It's in the rating pool now, and your",
        "report will start filling in as people rate you.",
        "",
        "You can remove it, or delete your account entirely, at any time.",
      ].join("\n")
    : [
        "A reviewer didn't approve your photo, so it was deleted and nobody saw it.",
        "",
        reason ? `Reason: ${reason}` : "No reason was recorded.",
        "",
        "You can upload a different photo, or carry on as a voter without one.",
      ].join("\n"),
});

export const newDataEmail = () => ({
  subject: "There's new data in your TrueHumanNature report",
  text: [
    "Enough people have rated and guessed about your photo that there's",
    "something new in your report.",
    "",
    "You asked to be told when this happens. You can switch it off at the",
    "bottom of your report.",
  ].join("\n"),
});
