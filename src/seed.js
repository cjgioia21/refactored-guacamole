// Seed demo profiles + a demo login so matchups, games, reports, and the
// credit economy all have data out of the box.
//   node src/seed.js         -> seeds if empty
// Demo login: demo@truehumannature.com / hunter2
import * as store from "./store.js";
import * as auth from "./auth.js";
import { QUESTIONS } from "./questions.js";
import { recordVote, attractedGenders, guessOutcome, GAMES } from "./engine.js";

function answersFor(seed) {
  const a = {};
  let s = seed;
  for (const q of QUESTIONS) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    a[q.id] = s % q.options.length;
  }
  return a;
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
  const created = PEOPLE.map(([name, gender, orientation, age, mentalHealth], i) =>
    store.create({
      name, gender, orientation, age, mentalHealth,
      photo: `https://i.pravatar.cc/300?img=${i + 5}`,
      socials: { instagram: name.toLowerCase() + "_" + (10 + i) },
      answers: answersFor(i + 1),
    })
  );

  // A demo account you can log into, linked to a real (rateable) profile.
  const acct = auth.signup("demo@truehumannature.com", "hunter2").account;
  const demo = store.create({
    accountId: acct.id, name: "Demo", gender: "man", orientation: "straight", age: 27,
    mentalHealth: [], photo: "https://i.pravatar.cc/300?img=12",
    socials: { instagram: "demo_thn" }, answers: answersFor(99),
  });
  auth.linkProfile(acct.id, demo.id);
  store.addCredits(demo.id, 120); // enough to reveal a few traits, not the 300 report

  const pool = [...created, demo];
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
  console.log(`Seeded ${pool.length} profiles (incl. demo@truehumannature.com / hunter2), matchups + guesses.`);
} else {
  console.log(`Store already has ${store.all().length} profiles; skipping seed.`);
}
