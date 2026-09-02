// Seed demo profiles so matchups, games, reports, and matches work out of the box.
// Run: node src/seed.js
import * as store from "./store.js";
import { QUESTIONS } from "./questions.js";
import { recordVote, attractedGenders } from "./engine.js";

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

  // Simulate matchups: each voter picks the winner they're more attracted to
  // (orientation-compatible + trait-similar), so Elo/type/admirer data fills in.
  const rnd = (n) => Math.floor(Math.random() * n);
  const traitSim = (p, q) =>
    Object.keys(p.traits).reduce((s, k) => s - Math.abs(p.traits[k] - q.traits[k]), 0);
  const appeal = (voter, cand) => {
    const wants = attractedGenders(voter.orientation, voter.gender);
    const orient = wants.includes(cand.gender) ? 1 : 0.1;
    return orient * (traitSim(voter, cand) + 5) - Math.abs(voter.age - cand.age) * 0.05;
  };

  for (let v = 0; v < 600; v++) {
    const voter = created[rnd(created.length)];
    let i = rnd(created.length);
    let j = rnd(created.length);
    while (j === i || created[i] === voter || created[j] === voter) {
      i = rnd(created.length);
      j = rnd(created.length);
    }
    const [x, y] = [created[i], created[j]];
    const winner = appeal(voter, x) >= appeal(voter, y) ? x : y;
    const loser = winner === x ? y : x;
    recordVote(voter, winner, loser);
  }
  store.save();
  console.log(`Seeded ${created.length} profiles and 600 matchups.`);
} else {
  console.log(`Store already has ${store.all().length} profiles; skipping seed.`);
}
