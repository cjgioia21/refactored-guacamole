// User reports and takedowns.
//
// The Terms promise a reporting path and a response window. A promise with no
// mechanism behind it is worse than no promise: it's the document a regulator
// reads back to you. So this is the mechanism.
//
// Two reasons matter more than the rest and are handled differently:
//   - a photo of a minor
//   - someone's photo uploaded by another person, or an intimate image
//     shared without consent
// Both HIDE THE PHOTO IMMEDIATELY on report, before any human looks. A false
// report costs one person a few hours offline. Getting it the other way round
// costs someone far more, and in the first case it is a criminal matter.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dataFile } from "./paths.js";

const FILE = dataFile("reports.json");

let reports = load();

function load() {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    /* corrupt/missing -> empty */
  }
  return [];
}

function persist() {
  try {
    writeFileSync(FILE, JSON.stringify(reports, null, 2));
  } catch {
    /* best-effort */
  }
}

// Reasons a photo can be reported. `urgent` ones take the photo down on sight.
// `response` is a whole sentence rather than a duration, because these don't
// share a grammar: "within immediately" is not a thing.
export const REASONS = {
  minor: {
    label: "This person looks under 18",
    urgent: true,
    response: "We look at these before anything else.",
  },
  not_them: {
    label: "This is my photo and I didn't upload it",
    urgent: true,
    response: "We aim to resolve this within 24 hours.",
  },
  intimate: {
    label: "Intimate image shared without consent",
    urgent: true,
    response: "We aim to resolve this within 24 hours.",
  },
  sexual: { label: "Nudity or sexual content", urgent: false, response: "We aim to review this within 5 business days." },
  impersonation: { label: "Not a real photo of this person", urgent: false, response: "We aim to review this within 5 business days." },
  other: { label: "Something else", urgent: false, response: "We aim to review this within 5 business days." },
};

export const isUrgent = (reason) => !!REASONS[reason]?.urgent;

// File a report. `reporterId` may be null: you should not need an account to
// report your own face, and the Terms say as much.
export function file({ targetId, reason, detail, reporterId = null, contact = null }) {
  if (!REASONS[reason] || !targetId) return null;
  const report = {
    id: randomUUID(),
    targetId,
    reason,
    urgent: isUrgent(reason),
    detail: detail ? String(detail).slice(0, 1000) : null,
    reporterId,
    contact: contact ? String(contact).slice(0, 120) : null, // for reports with no account
    status: "open", // open | actioned | dismissed
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
  };
  reports.unshift(report);
  persist();
  return report;
}

export function all() {
  return reports;
}

export function get(id) {
  return reports.find((r) => r.id === id) || null;
}

// Open reports, urgent first, then oldest — so the queue is worked in the order
// that keeps you inside the response windows the Terms commit to.
export function open() {
  return reports
    .filter((r) => r.status === "open")
    .sort((a, b) => (b.urgent - a.urgent) || a.createdAt.localeCompare(b.createdAt));
}

export function resolve(id, { status, resolution, by }) {
  const r = get(id);
  if (!r || (status !== "actioned" && status !== "dismissed")) return null;
  r.status = status;
  r.resolution = resolution ? String(resolution).slice(0, 300) : null;
  r.resolvedBy = by || "admin";
  r.resolvedAt = new Date().toISOString();
  persist();
  return r;
}

// How long the oldest open report has been waiting — the number that tells you
// whether you are actually meeting the windows you published.
export function oldestOpenAgeHours() {
  const oldest = open().at(-1);
  if (!oldest) return null;
  return Math.round((Date.now() - Date.parse(oldest.createdAt)) / 36e5);
}

export function countsFor(targetId) {
  const mine = reports.filter((r) => r.targetId === targetId);
  return { total: mine.length, open: mine.filter((r) => r.status === "open").length };
}

export function save() {
  persist();
}
