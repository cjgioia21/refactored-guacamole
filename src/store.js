// In-memory user store with JSON file persistence.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DATA_FILE = new URL("../data/users.json", import.meta.url);

let users = load();

function load() {
  try {
    if (existsSync(DATA_FILE)) {
      return JSON.parse(readFileSync(DATA_FILE, "utf8"));
    }
  } catch {
    // corrupt or missing file -> start empty
  }
  return [];
}

function persist() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
  } catch {
    // best-effort persistence; ignore write failures (e.g. read-only fs)
  }
}

export function all() {
  return users;
}

export function get(id) {
  return users.find((u) => u.id === id) || null;
}

export function create(profile) {
  const user = {
    id: randomUUID(),
    name: String(profile.name || "Anonymous").slice(0, 80),
    bio: String(profile.bio || "").slice(0, 500),
    subjects: arr(profile.subjects),
    goals: arr(profile.goals),
    languages: arr(profile.languages),
    level: profile.level || "beginner",
    style: profile.style || "flexible",
    availability: profile.availability || {},
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  persist();
  return user;
}

export function update(id, patch) {
  const user = get(id);
  if (!user) return null;
  for (const key of ["name", "bio", "level", "style"]) {
    if (patch[key] != null) user[key] = patch[key];
  }
  for (const key of ["subjects", "goals", "languages"]) {
    if (patch[key] != null) user[key] = arr(patch[key]);
  }
  if (patch.availability != null) user.availability = patch.availability;
  persist();
  return user;
}

export function remove(id) {
  const before = users.length;
  users = users.filter((u) => u.id !== id);
  persist();
  return users.length < before;
}

function arr(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}
