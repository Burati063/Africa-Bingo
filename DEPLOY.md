# Ethio Bingo — Production Deployment Roadmap

This is the shortest safe path from the current repository to a live Telegram Mini App that real
players can use with real money. Work through the phases in order.

> **What has to come from you:** a server (VPS) with SSH access, a domain name, a Telegram bot token
> from @BotFather, and the Telebirr/CBE accounts that receive deposits. The repository and deployment
> files are ready; the steps below are the part that runs on your infrastructure.

---

## Phase 0 — What is already production-shaped

| Area | State |
|------|-------|
| Build | Single Docker image builds the web app and runs the API + Socket.IO server |
| Data | SQLite in a Docker volume (fine for one instance; Postgres path below) |
| Money | Integer santim ledger, atomic balance updates, server-side RNG/win validation |
| Auth | Telegram `initData` HMAC + JWT, role-scoped admin/agent/player tokens |
| Game | Server-authoritative rounds; calls, cards, claims and payouts never trust the client |
| Voice | Recorded male Amharic clips in `web/public/audio/calls`, TTS only as fallback |
| Health | `GET /api/health`, Docker healthcheck configured |
| Ops | Admin audit log, CSV exports, manual deposit/withdrawal approval |

Known gaps to close before scaling beyond one server: PostgreSQL, PDF/KYC policy, payment-provider
webhooks, 2FA for staff, off-site backups, external uptime monitoring.

---

## Phase 1 — Server and DNS (30–45 min)

1. **VPS:** Ubuntu 22.04/24.04, 2 vCPU / 2 GB RAM / 40 GB SSD (Hetzner, DigitalOcean, Contabo, etc.).
2. Point a DNS **A record** for e.g. `bingo.yourdomain.com` at the server IP. Wait for propagation.
3. SSH in and install Docker + the Compose plugin:

   ```bash
   ssh root@YOUR_SERVER_IP
   apt update && apt upgrade -y
   curl -fsSL https://get.docker.com | sh
   docker --version && docker compose version
   ```

4. Open only SSH and HTTP/HTTPS in the firewall (`ufw allow OpenSSH`, `ufw allow 80,443/tcp`,
   `ufw enable`). **Do not expose port 4000 publicly** — Caddy will proxy it.

---

## Phase 2 — Production configuration (20 min)

```bash
git clone <your-repo-url> /opt/africa-bingo
cd /opt/africa-bingo
cp server/.env.example .env      # compose reads ./.env
```

Edit `.env` and set at minimum:

```ini
NODE_ENV=production
PORT=4000
JWT_SECRET=<64+ random characters>          # openssl rand -hex 32
PUBLIC_URL=https://bingo.yourdomain.com
CORS_ORIGIN=https://bingo.yourdomain.com
DEV_MODE=false

TELEGRAM_BOT_TOKEN=<token from @BotFather>
TELEGRAM_BOT_USERNAME=<bot username without @>

DATABASE_URL=file:/data/prod.db
DEPOSIT_TELEBIRR_ACCOUNT=<your deposit number>
DEPOSIT_TELEBIRR_NAME=<account holder>
DEPOSIT_CBE_ACCOUNT=<your CBE account>
DEPOSIT_CBE_NAME=<account holder>

ADMIN_EMAIL=<real admin email>
ADMIN_PASSWORD=<strong password, change after first login>
```

Generate the secret with `openssl rand -hex 32`. Keep `.env` readable only by root
(`chmod 600 .env`).

---

## Phase 3 — HTTPS reverse proxy (15 min)

Telegram only opens Mini Apps over HTTPS. Install Caddy on the host:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Create `/etc/caddy/Caddyfile`:

```caddyfile
bingo.yourdomain.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4000
}
```

```bash
systemctl reload caddy
```

Caddy obtains and renews the certificate automatically. Verify:
`curl https://bingo.yourdomain.com/api/health` → `{"ok":true,...}`.

---

## Phase 4 — Start the app (10 min)

```bash
cd /opt/africa-bingo
docker compose up --build -d
docker compose ps                 # bingo should become "healthy"
docker compose logs -f bingo      # watch startup, then Ctrl+C
curl https://bingo.yourdomain.com/api/health
```

Data lives in the `bingo-data` volume (`/data/prod.db`) and voice uploads in `bingo-uploads`.
On first boot the container creates the schema and seeds the admin account from `.env`.

Log in at `https://bingo.yourdomain.com/admin` with `ADMIN_EMAIL` / `ADMIN_PASSWORD` and immediately
change the password (or create a new admin and disable the seeded one).

---

## Phase 5 — Telegram setup (20 min)

1. In @BotFather: `/newbot` if needed, then `/setdescription`, `/setabouttext`, `/setuserpic`
   (use `web/public/logo.svg` converted to 512×512 PNG).
2. `/newapp` (or `/setmenubutton`) → choose the bot → title **Ethio Bingo** → URL
   `https://bingo.yourdomain.com`.
3. `/setdomain` → the same domain (needed for Telegram Web login).
4. Open the bot, tap the menu button, and confirm the Mini App loads with the logo splash.
5. Register with a real phone number and confirm the phone arrives on the player account in
   **Admin → Users** (the bot requests the contact on first launch).

Referral links use `PUBLIC_URL`/`TELEGRAM_BOT_USERNAME`; test one from the agent dashboard.

---

## Phase 6 — Pre-launch verification (1–2 hours)

Run these on the live server:

- [ ] Player joins a round, balance decreases by stake × cards, cards render.
- [ ] A full round runs: calls advance, voice announces numbers, Bingo claim pays out.
- [ ] Winner overlay shows the masked phone in the `+251*****9780` format.
- [ ] Card selector accepts 1–432 and the live cost/win estimate updates before the round starts.
- [ ] Deposit with a real Telebirr receipt is credited or lands in manual review.
- [ ] Withdrawal request reserves the balance; admin approval completes it.
- [ ] Removed banks are absent from the withdrawal dropdown; only supported banks remain.
- [ ] Admin panel: overview counts, users CSV export, phone-status filter, audit log.
- [ ] Kill the container (`docker compose restart`) mid-round: stakes are refunded on restart.
- [ ] Check logs for errors for 30 minutes under a few concurrent test players.

Then run the repository smoke test against the live URL (from a machine with the repo):

```bash
cd server
BASE_URL=https://bingo.yourdomain.com npm run smoke
```

---

## Phase 7 — Operations (ongoing)

**Backups (must have before real money):**

```bash
# nightly at 02:00 — database + uploads, kept 14 days
0 2 * * * docker run --rm -v africa-bingo_bingo-data:/data -v /opt/backups:/backup \
  alpine tar czf /backup/db-$(date +\%F).tgz -C /data . && \
  find /opt/backups -name 'db-*.tgz' -mtime +14 -delete
```

Copy `/opt/backups` off the server (object storage or another host). Test a restore quarterly.

**Monitoring:**

- External uptime check on `https://bingo.yourdomain.com/api/health` every minute (UptimeRobot,
  BetterStack, or a cron + Telegram alert).
- `docker compose logs --since 15m` reviewed daily for `[engine]`, `[deposits]`, and 5xx errors.
- Disk usage alert: SQLite + logs + uploads.

**Updates:**

```bash
cd /opt/africa-bingo && git pull
docker compose up --build -d
docker compose ps
```

**Daily business checks:** pending deposits, pending withdrawals, round payouts, agent commissions,
and the audit log.

---

## Phase 8 — Scale and hardening roadmap

Do these in order as volume grows:

1. **PostgreSQL** — change `datasource.provider` to `postgresql`, set a Postgres `DATABASE_URL`, add
   a `postgres` service to Compose, and move to `prisma migrate deploy` (create an initial migration
   first). Keep nightly `pg_dump` backups.
2. **Multi-instance realtime** — move the game engine to a single worker process and add the
   Socket.IO Redis adapter before running more than one app container.
3. **Payments** — replace receipt scraping with a provider webhook (Telebirr/CBE merchant API) so
   deposits are event-driven and idempotent.
4. **Compliance** — KYC for withdrawals above a threshold, AML monitoring, terms/privacy pages,
   responsible-gaming limits, and local legal review of real-money bingo.
5. **Security** — 2FA for staff, IP allow-list for `/admin`, secrets manager, dependency scanning,
   rate limits tuned per endpoint, audit-log retention.
6. **Observability** — structured logs, Sentry for exceptions, metrics (rounds/min, deposit success
   rate, payout latency), and on-call alerts.
7. **Performance** — WebSocket load test with 500+ simulated players; verify the 1 s engine tick keeps
   up and payout transactions stay under 200 ms.

---

## Rollback

If a deploy goes bad:

```bash
cd /opt/africa-bingo
git log --oneline -5
git checkout <last-good-commit>
docker compose up --build -d
```

If the database was damaged, stop the stack, restore the latest backup into the `bingo-data` volume,
and start again. The ledger is the source of truth — never edit balances by hand; use the admin
adjustment flow so the audit trail stays complete.

---

## Free hosting options (Telegram Mini App + bot)

Everything the app needs is **one Node process + one HTTPS URL**. The bot itself is free on Telegram.
Best free choices, in order:

| Option | What you get free | Good for | Notes |
|--------|-------------------|----------|-------|
| **Oracle Cloud Always Free** | 4 ARM cores, 24 GB RAM, 200 GB storage, always on | The real recommendation for a money app | Never sleeps, no credit-card charge, full control. ARM works with the Docker images. |
| **Fly.io** | Small shared VMs + 160 GB egress | Quick trial | Can scale to 0; set `min_machines_running = 1` so the game engine never sleeps. |
| **Koyeb** | One small always-on service | Simple demo | Free instance is small; fine for testing, not for 500 players. |
| **Render / Railway** | Free trial tiers | Preview only | Free Render services sleep, which stops the game engine. Do not use for live rounds. |
| **Cloudflare Tunnel** | Free HTTPS tunnel | Local/Telegram testing | URL changes on restart; use a named tunnel + free Cloudflare DNS for a stable hostname. |

**Recommended zero-cost production stack:** Oracle Cloud Always Free (Ubuntu 24.04 ARM) + this
repository's `docker-compose.prod.yml` (app + Caddy HTTPS) + Cloudflare DNS. It is genuinely free,
always on, and has enough CPU/RAM for 500+ concurrent players. Telegram requires HTTPS; Caddy gets
the certificate automatically.

---

## Serving 500+ concurrent players

500 Telegram players connected at once is mostly a **WebSocket + database** problem, not CPU. This
app already pushes state every second and persists every call, so do these in order:

1. **Keep the tuned SQLite for one instance; move to PostgreSQL when you scale out.** The app now
   enables WAL, `busy_timeout=8000`, a larger cache and `temp_store=MEMORY` at startup, which is
   enough for 500 players on one process (one call every 3 s; joins only in the 30 s window).
   Switch to PostgreSQL when you add a second app instance, run multiple writers, or pass roughly
   1,000 concurrent players:
   - In `server/prisma/schema.prisma` set `provider = "postgresql"`.
   - Add a `postgres:16-alpine` service with a volume and
     `DATABASE_URL=postgresql://bingo:<password>@postgres:5432/bingo?schema=public`.
   - Run `npx prisma migrate deploy` on boot (or `prisma db push` for the first cut) and seed once.
2. **Run exactly one game-engine process.** The round lives in memory. Do not scale the app container
   horizontally without moving the engine to a worker; the tick, timers and claims would split.
   For 500 players one Node process is enough — the per-second tick only broadcasts one snapshot and
   a single INSERT per call.
3. **Tune the host:** 2 vCPU / 2–4 GB RAM is sufficient for 500 concurrent sockets on Node 20.
   Raise the file-descriptor limit (`LimitNOFILE=65535` for the Docker service) and keep Node on the
   host network behind Caddy.
4. **Put Caddy in front** (already in Phase 3) for TLS termination, gzip/zstd and HTTP/2. Enable
   `proxy_read_timeout 300s` so long-lived WebSocket connections are not cut.
5. **Add the Socket.IO Redis adapter only when you run more than one web instance.** Players connect
   to any instance; Redis fans events out. The engine still stays single-instance.
6. **Database indexes and limits are already in place** (`calledNumbers` is unique per game, wallet
   updates are atomic, lists are capped). Add `pgbouncer` only if you exceed ~200 app-level queries/s.
7. **Load test before launch:** the repo ships a socket load test that signs player tokens locally
   (no login rate limit, no database rows):
   ```bash
   cd server
   npm run loadtest -- --players 500 --duration 60 --base https://bingo.yourdomain.com
   ```
   Watch `docker stats` and `docker compose -f docker-compose.prod.yml logs -f bingo`. Target 100%
   connections, about one `state` message per player per second, < 200 ms API p95 and a stable 1 s
   round tick.
8. **Operational guardrails:** nightly `pg_dump`, external uptime check every minute, Telegram alert
   on 5xx, and a restart policy (`restart: unless-stopped`) so the game engine comes back and refunds
   interrupted stakes (the engine already does this on boot).

### Minimal production `.env` for 500 players

```ini
DOMAIN=bingo.yourdomain.com
NODE_ENV=production
PORT=4000
DEV_MODE=false
PUBLIC_URL=https://bingo.yourdomain.com
CORS_ORIGIN=https://bingo.yourdomain.com
JWT_SECRET=<openssl rand -hex 32>
DATABASE_URL=file:/data/prod.db
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_BOT_USERNAME=<bot username without @>
ADMIN_EMAIL=<real admin email>
ADMIN_PASSWORD=<strong password>
DEPOSIT_TELEBIRR_ACCOUNT=<permanent Telebirr number>
DEPOSIT_TELEBIRR_NAME=<account holder>
DEPOSIT_CBE_ACCOUNT=<CBE account>
DEPOSIT_CBE_NAME=<account holder>
```

Then: `docker compose -f docker-compose.prod.yml up -d --build`, confirm
`https://<DOMAIN>/api/health`, set the same HTTPS URL as the bot's Mini App URL in BotFather, and
run `BASE_URL=https://<DOMAIN> npm --workspace server run smoke` before opening to players.

---

## Oracle Cloud Always Free — full step-by-step (recommended)

This is the cheapest setup that is genuinely production-capable: an always-on ARM VM, free HTTPS,
and no server bill. The bot is free on Telegram; only the domain (~$10/year) is optional if you use
Cloudflare's free DNS.

### 1. Create the instance

1. Sign up at <https://www.oracle.com/cloud/free/> and choose your home region (pick one near Ethiopia,
   e.g. Frankfurt or Johannesburg, for lower latency).
2. **Compute → Instances → Create instance**.
3. Image: **Ubuntu 24.04**. Shape: **Ampere · VM.Standard.A1.Flex**, **2 OCPU / 12 GB RAM**
   (Always Free allows up to 4 OCPU / 24 GB across instances).
4. Assign a **public IPv4 address**. Upload your SSH public key and create the instance.
5. Reserve the public IP (Networking → Reserved public IPs → assign to the instance) so it does not
   change on reboot.

### 2. Open ports 80/443

Oracle blocks everything except SSH by default. In **Networking → VCN → Security Lists → Default
Security List**, add ingress rules:

| Source | Protocol | Destination port |
|--------|----------|------------------|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |
| `0.0.0.0/0` | UDP | `443` (HTTP/3, optional) |

Then on the server:

```bash
ssh ubuntu@YOUR_PUBLIC_IP
sudo apt update && sudo apt upgrade -y
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw --force enable
```

### 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version
```

### 4. DNS

In Cloudflare (free plan) or your registrar, create an **A record**:

```
bingo.yourdomain.com  →  YOUR_RESERVED_PUBLIC_IP
```

Wait until `dig +short bingo.yourdomain.com` returns the IP. Caddy will not issue a certificate until
DNS resolves.

### 5. Deploy the app

```bash
sudo mkdir -p /opt/ethio-bingo && sudo chown $USER /opt/ethio-bingo
git clone <your-repo-url> /opt/ethio-bingo
cd /opt/ethio-bingo
cp server/.env.example .env
nano .env          # fill in the values below
chmod 600 .env
```

Minimum `.env` for the free server:

```ini
DOMAIN=bingo.yourdomain.com
NODE_ENV=production
PORT=4000
DEV_MODE=false
PUBLIC_URL=https://bingo.yourdomain.com
CORS_ORIGIN=https://bingo.yourdomain.com
JWT_SECRET=<output of: openssl rand -hex 32>
DATABASE_URL=file:/data/prod.db
TELEGRAM_BOT_TOKEN=<token from @BotFather>
TELEGRAM_BOT_USERNAME=<bot username without @>
ADMIN_EMAIL=<your admin email>
ADMIN_PASSWORD=<strong password, 16+ chars>
AGENT_EMAIL=<agent email>
AGENT_PASSWORD=<strong password>
DEPOSIT_TELEBIRR_ACCOUNT=<permanent Telebirr number>
DEPOSIT_TELEBIRR_NAME=<account holder>
DEPOSIT_CBE_ACCOUNT=<CBE account>
DEPOSIT_CBE_NAME=<account holder>
```

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl https://bingo.yourdomain.com/api/health
```

Expected: `{"ok":true,...}`. Caddy obtains and renews TLS automatically. Logs:

```bash
docker compose -f docker-compose.prod.yml logs -f bingo
docker compose -f docker-compose.prod.yml logs -f caddy
```

### 6. Register the bot and Mini App

1. In Telegram, open **@BotFather** → `/newbot` (e.g. `EthioBingoBot`). Copy the token into `.env`
   as `TELEGRAM_BOT_TOKEN`, then restart the stack.
2. `/newapp` → choose the bot → title `Ethio Bingo` → upload a 640×360 image.
3. **Web App URL:** `https://bingo.yourdomain.com` (no trailing path).
4. `/setmenubutton` → choose the bot → URL the same → button text `Play Bingo`.
5. `/setdomain` → `bingo.yourdomain.com` (needed for Telegram Web login).
6. `/setcommands` → `start - Open Ethio Bingo`.
7. Open the bot, tap the menu button, and complete one round on a phone.

### 7. Verify before opening to money

```bash
cd /opt/ethio-bingo/server
BASE_URL=https://bingo.yourdomain.com npm run smoke
npm run loadtest -- --players 500 --duration 60 --base https://bingo.yourdomain.com
```

Both must pass. Then check on the live site: a real deposit receipt is credited or lands in admin
review, a withdrawal reserves the balance, admin approve/reject works, and the audit log records each
admin action.

### 8. Operations on the free server

**Backups** (nightly, keep 14 days):

```bash
mkdir -p /opt/backups
crontab -e
# add:
0 2 * * * docker run --rm -v ethio-bingo_bingo-data:/data -v /opt/backups:/backup alpine tar czf /backup/db-$(date +\%F).tgz -C /data . && find /opt/backups -name 'db-*.tgz' -mtime +14 -delete
```

Confirm the volume name with `docker volume ls` (it is prefixed with the project directory name).
Copy `/opt/backups` off the server, and test a restore once.

**Updates:**

```bash
cd /opt/ethio-bingo && git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

**Uptime check:** point UptimeRobot/BetterStack at `https://bingo.yourdomain.com/api/health` every
minute and send alerts to your Telegram.

**Free-tier rules:** keep the instance running (Always Free resources are reclaimed only if you
upgrade/downgrade incorrectly), do not delete the boot volume, and stay within 10 TB/month egress —
500 players use a small fraction of that.

### 9. Free alternatives (and when they are wrong)

- **Fly.io** — set `min_machines_running = 1`; free allowances change, so check current pricing.
- **Koyeb** — one small always-on service; fine for a demo, not 500 players.
- **Render / Railway free** — they sleep. A sleeping process stops the game engine mid-round. Do not
  use free sleeping tiers for live money.
- **Cloudflare Tunnel** — excellent for local testing and a free HTTPS URL, but the quick-tunnel URL
  changes on restart. Use a named tunnel + your domain if you go this route.

### 10. Troubleshooting

| Symptom | Fix |
|---|---|
| Caddy cannot get a certificate | DNS is not pointing at the IP yet, or port 80/443 is blocked in the Oracle Security List |
| `502` from Caddy | `bingo` container is unhealthy: `docker compose -f docker-compose.prod.yml logs bingo` |
| Telegram opens a blank page | `PUBLIC_URL`/BotFather URL is wrong, `DEV_MODE=true`, or the container is down |
| “Could not sign in” in Telegram | `TELEGRAM_BOT_TOKEN` does not belong to the bot whose Mini App you opened |
| SQLite “database is locked” | Only run one app container; the app already enables WAL and `busy_timeout` |
| 500 players disconnect | Raise `nofile` (already 65535 in Compose), watch CPU/RAM with `docker stats` |
