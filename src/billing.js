// Payments, via Stripe Checkout.
//
// Ships DORMANT: with no STRIPE_SECRET_KEY the buy endpoint returns 503 and
// nothing can be bought. That is deliberate and it is an improvement on what
// was here before, which handed out the credits for free and returned
// `demo: true` — a demo checkout that reaches production is just a giveaway.
//
// BEFORE YOU TURN THIS ON: get Stripe's written confirmation that this business
// is acceptable to them. Their policies restrict certain adult and rating
// content, and being switched off after launch with customer balances
// outstanding is a much worse day than being told no beforehand.
//
// THE ONE RULE THAT MATTERS: credits are granted by the WEBHOOK, never by the
// browser coming back to the success URL. A success redirect is a URL the
// customer controls — anyone can open it, and granting there is the standard
// way sites give their product away. The webhook is signed by Stripe and is the
// only thing here that is allowed to add credits.
//
// No SDK and no dependency: Checkout is two HTTPS calls and an HMAC.

import { createHmac, timingSafeEqual } from "node:crypto";

const KEY = () => process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET || "";
export const configured = () => !!KEY();

// Stripe's API is form-encoded, including nested keys like line_items[0][price].
const form = (obj, prefix = "", out = new URLSearchParams()) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
};

async function stripe(path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `stripe ${res.status}`);
  return json;
}

// Create a Checkout Session for one credit pack. The card details are entered
// on Stripe's page — no card data ever reaches this server, which is most of
// why this integration is short.
export async function checkoutSession({ pack, accountId, profileId, email, baseUrl }) {
  return stripe("checkout/sessions", {
    mode: "payment",
    success_url: `${baseUrl}/?purchase=ok`,
    cancel_url: `${baseUrl}/?purchase=cancelled`,
    customer_email: email || undefined,
    // Read back on the webhook. The profile id is what we credit; keeping it
    // here means the webhook needs no lookup table of its own.
    client_reference_id: profileId,
    metadata: { profileId, accountId, packId: pack.id, credits: pack.credits },
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: process.env.STRIPE_CURRENCY || "cad",
          unit_amount: Math.round(pack.price * 100),
          product_data: { name: `${pack.credits} credits — TrueHumanNature` },
        },
      },
    },
  });
}

// Verify a webhook against the raw request body. Stripe signs
// "<timestamp>.<body>"; comparing anything re-serialized will not match, which
// is why the route mounts express.raw for this path only.
export function verifyWebhook(rawBody, signatureHeader, { toleranceSec = 300 } = {}) {
  const secret = WEBHOOK_SECRET();
  if (!secret) return { ok: false, reason: "STRIPE_WEBHOOK_SECRET is not set" };
  const parts = Object.fromEntries(
    String(signatureHeader || "").split(",").map((p) => p.split("=").map((x) => x.trim()))
  );
  const t = Number(parts.t);
  const given = parts.v1;
  if (!t || !given) return { ok: false, reason: "malformed signature header" };
  // A replayed request from days ago is refused even with a valid signature.
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return { ok: false, reason: "timestamp outside tolerance" };

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  try {
    return { ok: true, event: JSON.parse(rawBody.toString("utf8")) };
  } catch {
    return { ok: false, reason: "body is not JSON" };
  }
}

// What a completed checkout means, extracted from the event. Returns null for
// every other event type — Stripe sends many and we act on exactly one.
export function creditGrant(event) {
  if (event?.type !== "checkout.session.completed") return null;
  const session = event.data?.object;
  // Only a session that actually paid. An expired or unpaid one is not money.
  if (!session || session.payment_status !== "paid") return null;
  const credits = Number(session.metadata?.credits);
  const profileId = session.metadata?.profileId || session.client_reference_id;
  if (!profileId || !Number.isFinite(credits) || credits <= 0) return null;
  return { sessionId: session.id, profileId, credits, packId: session.metadata?.packId || null };
}
