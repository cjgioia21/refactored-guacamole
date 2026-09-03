# Deploying TrueHumanNature

It's a Node/Express server (`node server.js`) that listens on `PORT`. You need a
host that runs Node processes — **not** static hosting (Netlify/GitHub Pages
won't work). Any of the paths below works.

## What it needs

- **Node 18+**, `npm ci` then `node server.js`.
- **A writable data directory** — profiles/accounts/sessions persist to JSON
  files in `DATA_DIR` (default `./data`). On hosts with an *ephemeral* disk,
  point `DATA_DIR` at a **persistent volume**, or the data resets on redeploy.
- **Environment variables:**

  | Var | Required | Purpose |
  |-----|----------|---------|
  | `PORT` | usually set by host | port to listen on |
  | `NODE_ENV=production` | recommended | enables `Secure` cookies + `trust proxy` |
  | `SESSION_SECRET` | recommended | stable secret so logins survive restarts (any long random string). If unset, a `.secret` file is used. |
  | `DATA_DIR` | for persistence | absolute path to a persistent volume, e.g. `/data` |
  | `PHOTO_KEY` | **strongly recommended** | 64 hex chars (`openssl rand -hex 32`). Encrypts photos at rest. **Store it outside `DATA_DIR`** — a backup that contains its own key is not encrypted in any useful sense. If unset, a `.photokey` file is written *inside* `DATA_DIR`, which is convenient and much weaker. |
  | `PHOTO_URL_SECRET` | optional | signs photo URLs; falls back to `SESSION_SECRET`. Rotating it invalidates every outstanding photo link immediately. |
  | `ADMIN_EMAILS` | to review photos | comma-separated admin logins, e.g. `you@example.com`. Only these accounts see the **Review** tab. Nothing is published until one of them approves it. |
  | `PHOTO_HOURLY_BUDGET` | optional | photo fetches per account per hour (default 400). Exceeding it returns 429 and logs the account. |
  | `MODERATION_PROVIDER` | optional | `none` (default) = manual-only screening. |
  | `LEGAL_ENTITY` / `LEGAL_PROVINCE` / `LEGAL_CONTACT` / `LEGAL_EFFECTIVE_DATE` | **before launch** | filled into the Terms, Privacy Policy and Leaderboard Terms. Leave them unset and the documents ship with placeholder text naming no real entity. |
  | `BLOCKED_COUNTRIES` | optional | ISO codes, comma-separated. Defaults to the EU/EEA + UK. |
  | `BLOCKED_US_STATES` | optional | defaults to `IL` (Illinois BIPA). |
  | `BOARDS_ENABLED` | optional | set to `0` to switch the public leaderboards off entirely. |
  | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OAUTH_REDIRECT` | optional | enables the "Sign in with Google" button; email/password works without them |

> Persistence note: JSON files are fine for launch/small scale. Photos are
> **not** in the JSON — they live encrypted under `$DATA_DIR/photos/` — so
> `users.json` stays small. The remaining limit is that it's rewritten in full
> on every vote, which holds to roughly a thousand profiles. Past that, move to
> a database (`src/store.js` is the only file that reads/writes profile data).

## Before you launch: the legal setup

Three documents live in `legal/` and are served at `/api/legal/:doc`
(`terms`, `privacy`, `board`). They are a **thorough draft, not legal advice.**
Have a lawyer read them before you take a single payment or a single photo.

1. **Fill in the placeholders** with `LEGAL_ENTITY`, `LEGAL_PROVINCE`,
   `LEGAL_CONTACT` and `LEGAL_EFFECTIVE_DATE`. Unset, the documents name no real
   entity and are worth very little.
2. **Acceptance is recorded per account** — document key, version, timestamp and
   IP, stored in `accounts.json`. Bumping a `version` in `src/legal.js` forces
   every user to re-accept at their next request. An agreement you cannot prove
   someone accepted is close to unenforceable; this is the part most sites skip.
3. **Set `ADMIN_EMAILS`.** Nothing is published until a human approves it, so
   without an admin the site has no working photo pipeline at all.
4. **Confirm your payment processor will take this business, in writing, before
   you build billing on it.** Stripe and PayPal both prohibit certain sexual
   content, and being cut off after launch with customer balances outstanding is
   a far worse problem than being told no in advance.

### Regional blocking
`src/geo.js` blocks the EU/EEA, the UK, and Illinois, because this site collects
political opinions, sexual history, orientation and health data (GDPR Article 9
special-category data) and stores face photographs (Illinois BIPA treats these as
biometric identifiers, with statutory damages per person per violation).

**Country detection needs an upstream header.** Put Cloudflare in front of nginx
— it is free and sets `CF-IPCountry` on every request. Without such a header the
gate **fails open**, because failing closed would lock out every user the moment
a proxy config changed.

**US state detection is the weak link, and you should know it.** Free
country-level headers do not carry state. Illinois is enforced by a required
state selector at signup plus a clause in the Terms — a good-faith and
contractual control, not a technical one. If you want it to actually hold, wire
a geo-IP database (MaxMind GeoLite2 is free with an account) into
`geo.stateOf()`. And a VPN defeats all of it, as it does every geo-block on the
web.

## Photo storage — what to know before you launch

Photos are the most sensitive thing this site holds. How they're handled:

- **Sanitized on upload.** Every image is re-encoded by `sharp` before storage,
  which destroys EXIF — including the **GPS coordinates** a phone photo carries
  — along with embedded thumbnails and anything hidden in the file. Only JPEG,
  PNG and WebP are accepted; SVG is rejected outright, because an SVG is a
  script.
- **Encrypted at rest** with AES-256-GCM under a key derived per photo from
  `PHOTO_KEY`. A stolen disk or a copied backup is ciphertext.
- **No stable URLs.** Each photo link is an HMAC over
  (photo id, viewer's account id, expiry) and lasts ten minutes. A link that
  leaks or gets shared is dead on arrival and never worked in anyone else's
  session to begin with.
- **Rate limited.** `PHOTO_HOURLY_BUDGET` caps how many photos one account can
  pull per hour, and exceeding it is logged — the practical defence against a
  signed-up account scraping the whole library.
- **Deleted on rejection.** Rejecting a photo in review erases the bytes; it
  isn't merely hidden.

**What this does not protect against**, stated plainly so you can plan around it:
an admin reviewing photos sees all of them (that's the feature); a logged-in
user can screenshot anything on their screen; and if someone compromises the
running server they have the key in memory — encryption at rest protects stolen
disks and backups, not a live root shell.

**Operationally:** put `PHOTO_KEY` somewhere other than `DATA_DIR`, back the key
up separately (losing it means every stored photo is unrecoverable), keep
`$DATA_DIR/photos` at `chmod 700`, and make sure your backups are encrypted —
they contain the same ciphertext, which is only as safe as the key's separation
from it.

### Migrating an existing install
Older data stored photos inline in `users.json`. Move them into the blob store:

```bash
node scripts/migrate-photos.js --dry-run   # report only
node scripts/migrate-photos.js             # migrate (writes a .pre-photo-migration backup)
```
It's idempotent, so re-running is safe.

---

## Option A — Render / Railway (easiest)

Both deploy straight from your GitHub repo, give you HTTPS + a URL, and support
a persistent disk.

**Render** (render.com):
1. New → **Web Service** → connect this GitHub repo.
2. Build command: `npm ci` · Start command: `node server.js`.
3. Environment: add `NODE_ENV=production` and a long random `SESSION_SECRET`.
4. Add a **Disk**: mount path `/data`, then set `DATA_DIR=/data`.
5. Create — Render builds, deploys, and gives you `https://<name>.onrender.com`.

**Railway** (railway.app): New Project → Deploy from repo → it detects Node and
runs `node server.js` (Procfile included). Add the same env vars, and a **Volume**
mounted at `/data` with `DATA_DIR=/data`.

## Option B — Docker (anywhere)

```bash
docker build -t truehumannature .
docker run -d -p 80:3000 \
  -e NODE_ENV=production \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -v thn_data:/data \
  --name thn truehumannature
```

Runs on Fly.io, a VPS, Cloud Run, ECS, etc. `-v thn_data:/data` keeps data across
restarts.

## Option C — Your own VPS + domain (full control) — the guided runbook

Do these in order. Replace `yourdomain.com` and `<VPS IP>` throughout.

### 1. Buy a domain
Cloudflare Registrar / Porkbun / Namecheap (~$10/yr). Pick the name.

### 2. Create a VPS
DigitalOcean or Hetzner → Ubuntu 24.04 → the $5–6/mo size → add your SSH key.
Note the public **IP**.

### 3. Point DNS at the box
At the registrar, add two **A** records:

| Type | Name  | Value      |
|------|-------|------------|
| A    | `@`   | `<VPS IP>` |
| A    | `www` | `<VPS IP>` |

Wait until `dig +short yourdomain.com` returns your IP (minutes–hours).

### 4. Install + start the app (the setup script does the heavy lifting)
```bash
ssh root@<VPS IP>
git clone https://github.com/cjgioia21/refactored-guacamole thn && cd thn
sudo bash deploy/setup.sh
```
`setup.sh` installs Node 20, git, nginx, certbot, and pm2; generates a stable
`SESSION_SECRET` (stored at `/etc/thn.secret`) and a `PHOTO_KEY` (at
`/etc/thn.photokey`, deliberately outside the data directory); installs deps;
and starts the app
under **pm2** with `NODE_ENV=production DATA_DIR=/var/lib/thn`, set to relaunch on
reboot. Verify: `pm2 status` shows **thn** online, and
`curl -sf http://127.0.0.1:3000/auth/config` returns JSON.

### 5. nginx reverse proxy
```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/thn
sudo sed -i 's/__DOMAIN__/yourdomain.com/g' /etc/nginx/sites-available/thn
sudo ln -sf /etc/nginx/sites-available/thn /etc/nginx/sites-enabled/thn
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Free HTTPS
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```
Certbot rewrites the nginx config to add the 443 server and an http→https
redirect, and auto-renews.

### 7. Open the firewall (if `ufw` is on)
```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable
```

Done — `https://yourdomain.com` is live.

### Redeploying later
```bash
cd ~/thn && git pull && sudo bash deploy/setup.sh   # reloads pm2 with new code
```

---

## Google sign-in (optional)

To turn on the Google button, create an OAuth 2.0 Client (Google Cloud Console →
Credentials), add `https://yourdomain.com/auth/google/callback` as an authorized
redirect URI, then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`OAUTH_REDIRECT=https://yourdomain.com/auth/google/callback`.

## Seeding demo data (optional)

`npm run seed` populates demo profiles and a login (`demo@truehumannature.com` /
`hunter2`). Skip it for a real launch so the site starts empty.
