#!/usr/bin/env bash
# Ethio Bingo — one-command production install for a fresh Ubuntu 22.04/24.04 VM
# (Oracle Cloud Always Free, Hetzner, DigitalOcean, Contabo, ...).
#
# Run it from anywhere after SSH-ing into the server:
#
#   sudo DOMAIN=bingo.example.com \
#        TELEGRAM_BOT_TOKEN=123:ABC \
#        TELEGRAM_BOT_USERNAME=etioricabingo_bot \
#        ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' \
#        bash deploy/oracle-bootstrap.sh
#
# DOMAIN can be a hostname you own, or a free one that points at this machine's
# public IP without buying anything:  bingo.<IP-with-dashes>.sslip.io
# (for example: 123-45-67-89.sslip.io resolves to 123.45.67.89).
#
# Optional env: REPO_URL, BRANCH, INSTALL_DIR, JWT_SECRET, AGENT_EMAIL,
# AGENT_PASSWORD, DEPOSIT_TELEBIRR_ACCOUNT, DEPOSIT_TELEBIRR_NAME,
# DEPOSIT_CBE_ACCOUNT, DEPOSIT_CBE_NAME.
#
# Re-running the script pulls the latest code, keeps the database volume and
# restarts the stack.
set -euo pipefail

: "${DOMAIN:?set DOMAIN, e.g. DOMAIN=bingo.123-45-67-89.sslip.io}"
: "${ADMIN_EMAIL:?set ADMIN_EMAIL to the admin login email}"
: "${ADMIN_PASSWORD:?set ADMIN_PASSWORD to a strong password (16+ chars)}"

REPO_URL="${REPO_URL:-https://github.com/Burati063/Africa-Bingo.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ethio-bingo}"
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
BOT_USERNAME="${TELEGRAM_BOT_USERNAME:-}"
BOT_USERNAME="${BOT_USERNAME#https://t.me/}"; BOT_USERNAME="${BOT_USERNAME#t.me/}"; BOT_USERNAME="${BOT_USERNAME#@}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 48)}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

log() { printf '\n== %s ==\n' "$*"; }

log "Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl git
  curl -fsSL https://get.docker.com | sh
else
  apt-get install -y git >/dev/null 2>&1 || true
fi

log "Firewall (SSH, HTTP, HTTPS only)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw allow 443/udp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ufw status | head -8 || true
fi

log "Kernel tuning for 1000+ WebSocket connections"
cat > /etc/sysctl.d/99-ethio-bingo.conf <<'EOF'
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 16384
net.ipv4.tcp_max_syn_backlog = 16384
net.ipv4.ip_local_port_range = 10000 65000
net.ipv4.tcp_tw_reuse = 1
fs.file-max = 2097152
EOF
sysctl --system >/dev/null

log "Fetching the application"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --all --prune
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

log "Writing .env"
cat > "$INSTALL_DIR/.env" <<EOF
DOMAIN=$DOMAIN
NODE_ENV=production
PORT=4000
DEV_MODE=false
PUBLIC_URL=https://$DOMAIN
CORS_ORIGIN=https://$DOMAIN
JWT_SECRET=$JWT_SECRET
DATABASE_URL=file:/data/prod.db
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_BOT_USERNAME=$BOT_USERNAME
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
AGENT_EMAIL=${AGENT_EMAIL:-agent@$DOMAIN}
AGENT_PASSWORD=${AGENT_PASSWORD:-}
DEPOSIT_TELEBIRR_ACCOUNT=${DEPOSIT_TELEBIRR_ACCOUNT:-}
DEPOSIT_TELEBIRR_NAME=${DEPOSIT_TELEBIRR_NAME:-}
DEPOSIT_CBE_ACCOUNT=${DEPOSIT_CBE_ACCOUNT:-}
DEPOSIT_CBE_NAME=${DEPOSIT_CBE_NAME:-}
EOF
chmod 600 "$INSTALL_DIR/.env"

log "Building and starting the stack"
docker compose -f docker-compose.prod.yml up -d --build

log "Waiting for the app to become healthy"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    echo "app is up"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "app did not become healthy in time; showing logs:" >&2
    docker compose -f docker-compose.prod.yml logs --tail=80 bingo >&2
    exit 1
  fi
  sleep 5
done

log "Checking HTTPS (Caddy needs DNS to point here first)"
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo "https://$DOMAIN is live"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "HTTPS not ready yet. Check: dig +short $DOMAIN (must be this server's IP)," >&2
    echo "then open ports 80/443 in the Oracle VCN Security List." >&2
    docker compose -f docker-compose.prod.yml logs --tail=40 caddy >&2
  fi
  sleep 5
done

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  log "Pointing the Telegram menu button at https://$DOMAIN"
  curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setChatMenuButton" \
    -H 'Content-Type: application/json' \
    -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"Play Bingo\",\"web_app\":{\"url\":\"https://$DOMAIN\"}}}" \
    >/dev/null && echo "menu button set"
  curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setMyCommands" \
    -H 'Content-Type: application/json' \
    -d '{"commands":[{"command":"start","description":"Open Ethio Bingo"}]}' >/dev/null || true
fi

PORT_IP="$(curl -fsS -m 10 https://api.ipify.org || echo 'YOUR_SERVER_IP')"
cat <<EOF

Ethio Bingo is deployed.

  Player app : https://$DOMAIN
  Admin      : https://$DOMAIN/admin
  Agent      : https://$DOMAIN/agent
  Server IP  : $PORT_IP
  Install dir: $INSTALL_DIR

If DNS does not point here yet, create an A record for $DOMAIN -> $PORT_IP,
or use $PORT_IP with dashes as dots and ".sslip.io" (free, no domain needed).

Finish in @BotFather:
  /newapp        -> choose the bot -> Web App URL https://$DOMAIN
  /setmenubutton -> same URL, button text "Play Bingo"
  /setdomain     -> $DOMAIN

Then verify from a machine with this repo:
  cd server && BASE_URL=https://$DOMAIN npm run smoke
  cd server && npm run loadtest -- --players 1000 --duration 60 --base https://$DOMAIN

Logs:   cd $INSTALL_DIR && docker compose -f docker-compose.prod.yml logs -f bingo
Update: cd $INSTALL_DIR && git pull && docker compose -f docker-compose.prod.yml up -d --build
EOF
