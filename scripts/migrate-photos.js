// One-off migration: move inline photo bytes out of users.json and into the
// encrypted blob store.
//
//   node scripts/migrate-photos.js            # migrate
//   node scripts/migrate-photos.js --dry-run  # report what would change
//
// Idempotent: profiles already holding a photo id are skipped, so re-running it
// is safe. Photos that fail validation (an SVG, a broken file, a remote URL we
// can't fetch) are left in place and reported, not silently dropped.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import * as photos from "../src/photos.js";
import { dataFile } from "../src/paths.js";

const USERS = dataFile("users.json");
const dryRun = process.argv.includes("--dry-run");

if (!existsSync(USERS)) {
  console.log(`No ${USERS} — nothing to migrate.`);
  process.exit(0);
}

const users = JSON.parse(readFileSync(USERS, "utf8"));
let migrated = 0, already = 0, empty = 0, remote = 0;
const failed = [];

for (const u of users) {
  const photo = u.photo;
  if (!photo) { empty += 1; continue; }
  if (photos.isPhotoId(photo)) { already += 1; continue; }

  if (!String(photo).startsWith("data:")) {
    // A remote URL (the seed data uses these). Nothing to move into the store,
    // but it stays a privacy problem: the remote host sees every viewer.
    remote += 1;
    failed.push({ name: u.name, id: u.id, reason: "remote URL, not stored bytes" });
    continue;
  }

  if (dryRun) { migrated += 1; continue; }
  try {
    u.photo = await photos.put(photo);
    migrated += 1;
  } catch (err) {
    failed.push({ name: u.name, id: u.id, reason: err.message });
  }
}

if (!dryRun && migrated) {
  // Keep a copy of the pre-migration file — it still holds the only copy of any
  // photo that failed to convert. Delete it once you've checked the results.
  copyFileSync(USERS, `${USERS}.pre-photo-migration`);
  writeFileSync(USERS, JSON.stringify(users, null, 2));
}

console.log(`${dryRun ? "[dry run] " : ""}photos migrated: ${migrated}`);
console.log(`  already migrated: ${already}`);
console.log(`  no photo:         ${empty}`);
console.log(`  remote URLs:      ${remote}`);
console.log(`  blobs on disk:    ${photos.count()}`);
if (failed.length) {
  console.log(`\n${failed.length} could not be migrated:`);
  for (const f of failed) console.log(`  - ${f.name} (${f.id}): ${f.reason}`);
}
if (!dryRun && migrated) console.log(`\nBackup written to ${USERS}.pre-photo-migration`);
