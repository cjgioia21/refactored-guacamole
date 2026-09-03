// Seed demo profiles + a demo login so matchups, games, reports, and the
// credit economy all have data out of the box.
//   node src/seed.js         -> seeds if empty
// Demo login: demo@truehumannature.com / hunter2
import sharp from "sharp";
import * as store from "./store.js";
import * as photos from "./photos.js";
import * as auth from "./auth.js";
import * as legal from "./legal.js";
import { QUESTIONS } from "./questions.js";
import { MORAL_QUESTIONS } from "./morality.js";
import { recordVote, attractedGenders, guessOutcome, GAMES, topTen, BOARD_MIN_MATCHUPS } from "./engine.js";

function answersFor(seed, bank = QUESTIONS) {
  const a = {};
  let s = seed;
  for (const q of bank) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    a[q.id] = s % q.options.length;
  }
  return a;
}
// A morality quiz answered around a chosen moral centre, so the seeded pool
// spreads across the verdict bands instead of clustering at zero.
function moralFor(seed, lean = 0) {
  const a = {};
  let s = seed;
  for (const q of MORAL_QUESTIONS) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const jitter = (s % 3) - 1; // -1, 0 or 1
    const want = Math.max(-2, Math.min(2, lean + jitter));
    a[q.id] = q.options.findIndex((o) => o.value === want);
  }
  return a;
}

// Demo portraits, generated locally. The old seed pointed at a remote avatar
// service, which meant that host saw every viewer of the site — exactly the
// leak the rest of this work exists to close.
async function demoPhoto(i) {
  const hue = (i * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="520">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},62%,58%)"/><stop offset="100%" stop-color="hsl(${(hue + 48) % 360},58%,38%)"/>
    </linearGradient></defs>
    <rect width="400" height="520" fill="url(#g)"/>
    <circle cx="200" cy="196" r="86" fill="hsl(${hue},40%,86%)"/>
    <ellipse cx="200" cy="430" rx="132" ry="130" fill="hsl(${hue},40%,86%)"/>
  </svg>`;
  // Rasterized to a JPEG before it goes near the store — put() refuses SVG.
  return photos.put(await sharp(Buffer.from(svg)).jpeg().toBuffer());
}

const PEOPLE = [
  ["Ava", "woman", "straight", 24, ["anxiety"]],
  ["Ben", "man", "straight", 27, []],
  ["Cleo", "woman", "bi", 22, ["adhd"]],
  ["Diego", "man", "gay", 31, []],
  ["Esme", "woman", "lesbian", 29, ["depression"]],
  ["Finn", "man", "straight", 26, ["adhd"]],
  ["Gia", "woman", "straight", 33, []],
  ["Hugo", "man", "bi", 28, ["bipolar"]],
  ["Iris", "woman", "straight", 21, []],
  ["Jax", "man", "straight", 35, ["ptsd"]],
  ["Kira", "woman", "lesbian", 25, ["anxiety"]],
  ["Leo", "man", "gay", 30, []],
];

if (store.all().length === 0) {
  const created = await Promise.all(PEOPLE.map(async ([name, gender, orientation, age, mentalHealth], i) =>
    store.create({
      name, gender, orientation, age, mentalHealth,
      photo: await demoPhoto(i),
      socials: { instagram: name.toLowerCase() + "_" + (10 + i) },
      answers: answersFor(i + 1),
      // Spread the pool across the moral spectrum: saints through to monsters.
      moralAnswers: moralFor(i + 1, [-2, -1, -1, 0, 0, 0, 0, 1, 1, 1, 2, 2][i % 12]),
    })
  ));

  // A demo account you can log into, linked to a real (rateable) profile.
  const acct = auth.signup("demo@truehumannature.com", "hunter2").account;
  // Record the demo account's agreement acceptance, or it gets stopped by the
  // consent gate on first login — same as any real account would be.
  for (const key of legal.REQUIRED) auth.recordAgreement(acct.id, key, legal.acceptanceRecord(key, "127.0.0.1"));
  const demo = store.create({
    accountId: acct.id, name: "Demo", gender: "man", orientation: "straight", age: 27,
    mentalHealth: [], photo: await demoPhoto(99),
    socials: { instagram: "demo_thn" }, answers: answersFor(99), moralAnswers: moralFor(99, 0),
  });
  auth.linkProfile(acct.id, demo.id);
  // No starting credits. The whole economy is that you have to grind or pay,
  // so the demo account should feel exactly what a real new user feels.

  const pool = [...created, demo];
  // Demo photos are pre-approved so the seeded site is usable immediately.
  for (const u of pool) store.moderatePhoto(u.id, "approve", "seeded demo profile", "seed");

  const rnd = (n) => Math.floor(Math.random() * n);
  const traitSim = (p, q) => Object.keys(p.traits).reduce((s, k) => s - Math.abs(p.traits[k] - q.traits[k]), 0);
  const appeal = (voter, cand) => {
    const wants = attractedGenders(voter.orientation, voter.gender);
    return (wants.includes(cand.gender) ? 1 : 0.1) * (traitSim(voter, cand) + 5) - Math.abs(voter.age - cand.age) * 0.05;
  };

  // Matchups (demo appears often so its report is populated).
  for (let v = 0; v < 800; v++) {
    const voter = pool[rnd(pool.length)];
    let x = pool[rnd(pool.length)];
    let y = Math.random() < 0.4 ? demo : pool[rnd(pool.length)];
    if (x === voter || y === voter || x === y) continue;
    const winner = appeal(voter, x) >= appeal(voter, y) ? x : y;
    recordVote(voter, winner, winner === x ? y : x);
  }

  // Demo rates a lot so its taste traits (every 75 rates) unlock for the report.
  for (let v = 0; v < 240; v++) {
    let x = created[rnd(created.length)];
    let y = created[rnd(created.length)];
    if (x === y) continue;
    recordVote(demo, appeal(demo, x) >= appeal(demo, y) ? x : y, appeal(demo, x) >= appeal(demo, y) ? y : x);
  }

  // Strangers guess about photos (populates "what strangers guess about you").
  for (let g = 0; g < 600; g++) {
    const target = pool[rnd(pool.length)];
    const game = GAMES[rnd(GAMES.length)];
    // guess correctly ~65% of the time
    const truth = guessOutcome(target, game.axis, "high").actual;
    const guess = Math.random() < 0.65 ? truth : truth === "high" ? "low" : "high";
    store.recordGuessAbout(target.id, game.axis, guess);
  }

  store.save();
  const ranked = topTen(pool, "woman").of + topTen(pool, "man").of;
  console.log(`Seeded ${pool.length} approved profiles (incl. demo@truehumannature.com / hunter2); ${ranked} clear the ${BOARD_MIN_MATCHUPS}-matchup floor for the Top 10.`);
} else {
  console.log(`Store already has ${store.all().length} profiles; skipping seed.`);
}
