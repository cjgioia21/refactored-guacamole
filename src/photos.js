// Encrypted, content-addressed photo storage.
//
// Photos never live in users.json. A profile holds a photo *id*; the bytes live
// under DATA_DIR/photos/<aa>/<id>.enc, encrypted with AES-256-GCM.
//
// What this design actually buys, honestly:
//   - A stolen disk, a leaked backup, or a snapshot copied off the host is
//     ciphertext. It does NOT protect against someone who owns the running
//     process — they have the key in memory.
//   - Every upload is re-encoded by sharp before it is stored, which destroys
//     EXIF (a phone photo carries the GPS coordinates of where it was taken),
//     embedded thumbnails, colour profiles, and anything smuggled in the
//     container. This is the single highest-value step in the whole file.
//   - Only JPEG/PNG/WebP are accepted. SVG is refused outright: an SVG is a
//     script, and storing one and serving it back is stored XSS.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, createHash, hkdfSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { DATA_DIR, dataFile } from "./paths.js";

export const PHOTO_DIR = join(DATA_DIR, "photos");
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // what we'll accept in
export const MAX_DIMENSION = 1024; // what we store, after downscaling

// ---- master key ----
// Prefer PHOTO_KEY (64 hex chars). Deployments should keep it OUTSIDE DATA_DIR,
// or a stolen backup carries its own key and the encryption buys nothing.
const KEY_FILE = dataFile(".photokey");
const MASTER = loadMasterKey();

function loadMasterKey() {
  const env = process.env.PHOTO_KEY;
  if (env) {
    const buf = Buffer.from(env.trim(), "hex");
    if (buf.length !== 32) throw new Error("PHOTO_KEY must be 64 hex characters (32 bytes)");
    return buf;
  }
  try {
    if (existsSync(KEY_FILE)) return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex");
    const key = randomBytes(32);
    writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
    return key;
  } catch {
    // Ephemeral fallback: photos written this run won't survive a restart, but
    // the process still works rather than crashing on a read-only disk.
    return randomBytes(32);
  }
}

// Per-photo key derived from the master key + the photo id, so two photos never
// share key material and a single leaked derived key exposes exactly one photo.
const keyFor = (id) => Buffer.from(hkdfSync("sha256", MASTER, Buffer.from(id), Buffer.from("thn-photo"), 32));

// ---- format sniffing ----
// Trust the bytes, never the declared content type or the file extension.
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

// Accept a data: URL or a raw Buffer; reject everything else early.
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  const s = String(input || "");
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(s);
  if (!m) return null;
  return Buffer.from(m[2], "base64");
}

export class PhotoError extends Error {}

const shardDir = (id) => join(PHOTO_DIR, id.slice(0, 2));
const blobPath = (id) => join(shardDir(id), `${id}.enc`);

// Store a photo. Returns its id. Throws PhotoError with a user-safe message.
export async function put(input) {
  const raw = toBuffer(input);
  if (!raw || !raw.length) throw new PhotoError("that doesn't look like an image file");
  if (raw.length > MAX_UPLOAD_BYTES) throw new PhotoError("that image is too large (8MB max)");
  const kind = sniff(raw);
  if (!kind) throw new PhotoError("only JPEG, PNG and WebP images are accepted");

  // The sanitizing step. Re-encoding to a fresh JPEG is what removes EXIF/GPS
  // and anything hidden in the original container — we keep only pixels.
  let clean;
  try {
    clean = await sharp(raw, { failOn: "error" })
      .rotate() // apply the EXIF orientation before we throw the EXIF away
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PhotoError("that image couldn't be processed — try a different one");
  }

  const id = randomUUID().replace(/-/g, "");
  const key = keyFor(id);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(clean), cipher.final()]);
  const tag = cipher.getAuthTag();

  mkdirSync(shardDir(id), { recursive: true, mode: 0o700 });
  // Layout: [12-byte IV][16-byte GCM tag][ciphertext]
  writeFileSync(blobPath(id), Buffer.concat([iv, tag, body]), { mode: 0o600 });
  return id;
}

// Read a photo back. Returns a Buffer, or null if it isn't there.
// A failed auth tag means the file was tampered with — treat it as missing.
export function get(id) {
  if (!isPhotoId(id)) return null;
  const file = blobPath(id);
  if (!existsSync(file)) return null;
  try {
    const blob = readFileSync(file);
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const decipher = createDecipheriv("aes-256-gcm", keyFor(id), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}

export function exists(id) {
  return isPhotoId(id) && existsSync(blobPath(id));
}

// Delete means delete: a rejected photo should not sit on the disk forever.
export function remove(id) {
  if (!isPhotoId(id)) return false;
  try {
    rmSync(blobPath(id), { force: true });
    return true;
  } catch {
    return false;
  }
}

// Photo ids are 32 lowercase hex chars. Validating this before touching the
// filesystem is what stops `../../etc/passwd` from ever becoming a path.
export function isPhotoId(id) {
  return typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
}

// Count of stored blobs — used by the migration script and ops checks.
export function count() {
  try {
    return readdirSync(PHOTO_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .reduce((n, d) => n + readdirSync(join(PHOTO_DIR, d.name)).length, 0);
  } catch {
    return 0;
  }
}

// A stable fingerprint of the stored bytes, for de-duplication if it's ever
// wanted. Not used for addressing — ids are random so the store can't be probed
// by hashing a photo you already have and asking whether it exists.
export const fingerprint = (buf) => createHash("sha256").update(buf).digest("hex");
