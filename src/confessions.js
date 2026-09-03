// Aggregate tallies for the morality quiz: how everyone else answered.
//
// This is the payoff that makes the quiz worth taking. You answer "yes, I'd
// press the button", and the site immediately tells you 61% of people said the
// same — or that only 4% did. Nothing here is per-user; only counts are stored,
// so the tally can never be worked backwards to an individual.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { MORAL_QUESTIONS } from "./morality.js";
import { dataFile } from "./paths.js";

const FILE = dataFile("moral-tally.json");

// { [qid]: { counts: [n, n, n, n, n], total } }
let tally = load();

function load() {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    /* corrupt/missing -> empty */
  }
  return {};
}

function persist() {
  try {
    writeFileSync(FILE, JSON.stringify(tally, null, 2));
  } catch {
    /* best-effort (e.g. read-only fs) */
  }
}

const question = (qid) => MORAL_QUESTIONS.find((q) => q.id === qid) || null;

function row(qid) {
  const q = question(qid);
  if (!q) return null;
  if (!tally[qid] || tally[qid].counts?.length !== q.options.length) {
    tally[qid] = { counts: new Array(q.options.length).fill(0), total: 0 };
  }
  return tally[qid];
}

// Record one answer. `previous` un-counts an earlier answer to the same
// question, so changing your mind doesn't inflate the totals.
export function record(qid, optionIndex, previous = null) {
  const r = row(qid);
  const q = question(qid);
  if (!r || !q || !q.options[optionIndex]) return null;
  if (previous != null && q.options[previous] && r.counts[previous] > 0) {
    r.counts[previous] -= 1;
    r.total -= 1;
  }
  r.counts[optionIndex] += 1;
  r.total += 1;
  persist();
  return stats(qid, optionIndex);
}

// What everyone else said, and where this answer sits among them.
export function stats(qid, optionIndex = null) {
  const q = question(qid);
  const r = tally[qid];
  if (!q) return null;
  const counts = r?.counts || new Array(q.options.length).fill(0);
  const total = r?.total || 0;
  const pct = (n) => (total ? Math.round((n / total) * 100) : null);
  const shares = q.options.map((o, i) => ({ label: o.label, pct: pct(counts[i]) }));

  let you = null;
  if (optionIndex != null && q.options[optionIndex]) {
    // How many people answered something *worse* than you did.
    const worse = q.options.reduce(
      (n, o, i) => n + (o.value > q.options[optionIndex].value ? counts[i] : 0), 0);
    you = {
      pct: pct(counts[optionIndex]),
      worsePct: pct(worse),
      // The line the UI shows straight after you answer.
      line: total < 5
        ? "You're one of the first to answer this. Nowhere to hide yet."
        : `${pct(counts[optionIndex])}% of people gave the same answer.`,
    };
  }
  return { qid, total, shares, you };
}

// Percentile of a completed score against everyone who has taken the quiz.
// Kept in the profile store's hands (it holds the scores); this is the copy.
export function harsherThan(pct) {
  if (pct == null) return null;
  return `You answered worse than ${pct}% of everyone who has taken this quiz.`;
}

export function all() {
  return tally;
}
