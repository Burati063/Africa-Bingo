# Africa Bingo — Production Deployment Roadmap

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
| Voice | Admin recordings, Amharic browser TTS fallback |
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
2. `/newapp` (or `/setmenubutton`) → choose the bot → title **Africa Bingo** → URL
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
