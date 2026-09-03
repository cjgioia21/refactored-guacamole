#!/usr/bin/env bash
# TrueHumanNature — one-shot VPS bootstrap for a fresh Ubuntu 22.04/24.04 box.
# Idempotent: safe to re-run (e.g. after a git pull) to redeploy.
#
#   sudo bash deploy/setup.sh
#
# Installs Node 20, git, nginx, certbot, and pm2; installs deps; and starts the
# app under pm2 with production env. Run from inside the cloned repo.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATA_DIR:-/var/lib/thn}"
SECRET_FILE="/etc/thn.secret"

echo "==> TrueHumanNature setup (app: $APP_DIR, data: $DATA_DIR)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo: sudo bash deploy/setup.sh" >&2
  exit 1
fi

echo "==> Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git nginx
# certbot for HTTPS (via snap is Certbot's recommended path)
if ! command -v certbot >/dev/null 2>&1; then
  apt-get install -y snapd
  snap install core >/dev/null 2>&1 || true
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi

echo "==> Installing Node.js 20 (if needed)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Installing pm2"
npm install -g pm2 >/dev/null 2>&1 || npm install -g pm2

echo "==> Preparing data dir + session secret"
mkdir -p "$DATA_DIR"
if [ ! -f "$SECRET_FILE" ]; then
  head -c 32 /dev/urandom | xxd -p -c 64 > "$SECRET_FILE" 2>/dev/null || openssl rand -hex 32 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi
SESSION_SECRET="$(cat "$SECRET_FILE")"

echo "==> Installing app dependencies"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> Starting under pm2"
NODE_ENV=production DATA_DIR="$DATA_DIR" SESSION_SECRET="$SESSION_SECRET" \
  pm2 startOrReload deploy/pm2.config.cjs --update-env
pm2 save
# Configure pm2 to start on boot (prints/handles the systemd unit).
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || pm2 startup || true
pm2 save

echo "==> App is up on http://127.0.0.1:3000"
echo "    Next: set up nginx + HTTPS (see deploy/nginx.conf.example and DEPLOY.md)."
