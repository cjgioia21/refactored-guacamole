// Load a local .env before anything else reads process.env.
//
// This must be the FIRST import in server.js: ES modules evaluate imports in
// source order, and src/auth.js / src/photos.js read their secrets at module
// load time. Import it any later and they'll have already missed the values.
//
// Node has this built in (>= 20.12), so there's no dotenv dependency. A missing
// .env is not an error — production sets real environment variables instead.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENV_FILE = process.env.ENV_FILE || join(dirname(fileURLToPath(import.meta.url)), "..", ".env");

if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    console.warn(`[env] couldn't read ${ENV_FILE}: ${err.message}`);
  }
}
