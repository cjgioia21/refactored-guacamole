// Resolve where JSON data lives. Defaults to ../data, but honors DATA_DIR so a
// host can point it at a persistent volume. The directory is created if missing.
//
// env.js is imported here, first, because every module that touches stored data
// imports this one. Without it a script run directly (src/seed.js, the photo
// migration) would miss .env and pick different secrets than the server —
// which silently produces photos the server cannot decrypt.
import "./env.js";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR
  ? (isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : join(process.cwd(), process.env.DATA_DIR))
  : join(here, "..", "data");

try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* best-effort */
}

export const dataFile = (name) => join(DATA_DIR, name);
