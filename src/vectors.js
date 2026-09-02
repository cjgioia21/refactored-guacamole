// Trait-vector helpers. Vectors are plain objects { axis: number }.
import { AXES } from "./questions.js";

const KEYS = Object.keys(AXES);

export function zero() {
  const v = {};
  for (const k of KEYS) v[k] = 0;
  return v;
}

export function dot(a, b) {
  let s = 0;
  for (const k of KEYS) s += (a[k] || 0) * (b[k] || 0);
  return s;
}

export function norm(a) {
  return Math.sqrt(dot(a, a));
}

// Cosine similarity mapped from [-1,1] to [0,1]. Empty vectors -> 0.5 (neutral).
export function similarity(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0.5;
  const cos = dot(a, b) / (na * nb);
  return (cos + 1) / 2;
}

// Incremental mean accumulator: { vector, n }. Folds `v` into it in place.
export function accumulate(acc, v, weight = 1) {
  acc.n = (acc.n || 0) + weight;
  acc.vector = acc.vector || zero();
  for (const k of KEYS) {
    acc.vector[k] += (weight / acc.n) * ((v[k] || 0) - acc.vector[k]);
  }
  return acc;
}

export function emptyAcc() {
  return { vector: zero(), n: 0 };
}
