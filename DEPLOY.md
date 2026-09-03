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
  | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OAUTH_REDIRECT` | optional | enables the "Sign in with Google" button; email/password works without them |

> Persistence note: JSON files are fine for launch/small scale. For real traffic
> or multiple instances, move to a database (the store in `src/store.js` is the
> only file that reads/writes data — swap its file I/O for a DB there).

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
`SESSION_SECRET` (stored at `/etc/thn.secret`); installs deps; and starts the app
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
