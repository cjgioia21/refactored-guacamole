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

## Option C — Your own VPS (full control)

On an Ubuntu box (DigitalOcean/Hetzner/EC2):

```bash
# 1. install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. get the code + deps
git clone <your repo> thn && cd thn
npm ci

# 3. run it under a process manager
sudo npm i -g pm2
NODE_ENV=production SESSION_SECRET="$(openssl rand -hex 32)" DATA_DIR=/var/lib/thn \
  pm2 start server.js --name thn
pm2 save && pm2 startup   # restart on reboot
```

Put **nginx** in front for HTTPS (reverse proxy to `localhost:3000`) and get a
free cert with certbot:

```nginx
server {
  server_name yourdomain.com;
  location / { proxy_pass http://localhost:3000; proxy_set_header Host $host;
               proxy_set_header X-Forwarded-Proto $scheme; }
}
```
```bash
sudo certbot --nginx -d yourdomain.com
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
