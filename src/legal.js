// Legal documents and acceptance records.
//
// An agreement nobody can prove you accepted is close to worthless. So every
// acceptance is stored against the account with the document version, a
// timestamp, and the IP it came from — and bumping a version forces everyone to
// accept again at their next request.
//
// Documents live as Markdown in legal/. They're rendered to simple HTML here so
// there's no Markdown dependency and no chance of the docs drifting out of sync
// with what users actually agreed to.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LEGAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "legal");

// Bump a version when the substance changes — that forces re-acceptance.
// Keep these in step with the "Version" line inside each document.
export const DOCS = {
  terms: { file: "terms.md", version: "1.0", title: "Terms of Service" },
  privacy: { file: "privacy.md", version: "1.0", title: "Privacy Policy" },
  board: { file: "board-terms.md", version: "1.0", title: "Leaderboard Terms" },
};

// Placeholders filled from env so the same documents work for any deployment.
const FIELDS = {
  LEGAL_ENTITY: process.env.LEGAL_ENTITY || "the operator of TrueHumanNature",
  PROVINCE: process.env.LEGAL_PROVINCE || "Ontario",
  CONTACT_EMAIL: process.env.LEGAL_CONTACT || process.env.ADMIN_EMAILS?.split(",")[0]?.trim() || "support@truehumannature.com",
  EFFECTIVE_DATE: process.env.LEGAL_EFFECTIVE_DATE || "1 January 2026",
};

const cache = new Map();

export function docText(key) {
  const doc = DOCS[key];
  if (!doc) return null;
  if (cache.has(key)) return cache.get(key);
  const path = join(LEGAL_DIR, doc.file);
  if (!existsSync(path)) return null;
  let text = readFileSync(path, "utf8");
  for (const [k, v] of Object.entries(FIELDS)) text = text.replaceAll(`[${k}]`, v);
  cache.set(key, text);
  return text;
}

// Minimal Markdown -> HTML. Deliberately tiny and escaping-first: these are our
// own documents, but rendering them through anything clever would be a way for
// a future edit to introduce script into a page every user is forced to read.
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function docHtml(key) {
  const text = docText(key);
  if (text == null) return null;
  const out = [];
  let inList = false;
  let para = [];
  let item = null;

  // The source is hard-wrapped at ~80 columns for readability in the repo, so
  // consecutive lines have to be joined back into one paragraph or list item —
  // otherwise every wrapped line renders as its own paragraph.
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushItem = () => { if (item) { out.push(`<li>${inline(item.join(" "))}</li>`); item = null; } };
  const closeList = () => { flushItem(); if (inList) { out.push("</ul>"); inList = false; } };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*$/.test(line)) { flushPara(); closeList(); continue; }
    if (/^---+$/.test(line)) { flushPara(); closeList(); out.push("<hr />"); continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      flushItem();
      if (!inList) { out.push("<ul>"); inList = true; }
      item = [li[1]];
      continue;
    }
    // An indented continuation line belongs to the list item above it.
    if (inList && /^\s{2,}\S/.test(raw)) { (item ||= []).push(line.trim()); continue; }

    closeList();
    para.push(line.replace(/^>\s?/, "").trim());
  }
  flushPara();
  closeList();
  return out.join("\n");
}

// ---- acceptance ----
// Which documents must be accepted before the app is usable at all. The board
// terms are deliberately NOT here: they gate one optional feature, not the site.
export const REQUIRED = ["terms", "privacy"];

export const currentVersion = (key) => DOCS[key]?.version || null;

// Has this account accepted the current version of everything required?
export function outstanding(account) {
  const agreed = account?.agreements || {};
  return REQUIRED.filter((key) => agreed[key]?.version !== DOCS[key].version);
}

export function hasAccepted(account, key) {
  return account?.agreements?.[key]?.version === DOCS[key]?.version;
}

// Build the record to store. The IP matters: it's the difference between "we
// think they agreed" and evidence of who agreed, from where, and when.
export function acceptanceRecord(key, ip) {
  return {
    version: DOCS[key].version,
    acceptedAt: new Date().toISOString(),
    ip: ip ? String(ip).slice(0, 45) : null,
  };
}
