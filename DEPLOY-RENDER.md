# Deploy on Render (free, no credit card)

Render is the cheapest way to run this app without a card **and** without rewriting it: it runs the
existing `Dockerfile` as one long-lived Node process, so Socket.IO and the in-memory game engine work
exactly as they do on a VPS.

What you need: a GitHub repo (already have one), a free Neon account, a free Render account, and the
bot token from @BotFather. No card at any step.

Trade-offs of the free plan (read before you rely on it for real money):

| Limit | Effect | Mitigation |
|---|---|---|
| Sleeps after 15 min without traffic | First player waits ~60 s | Free uptime monitor pings `/api/health` every 5 min |
| 750 instance-hours / month | One always-warm service uses ~744 | Only one service — never scale above 1 |
| 0.1 CPU, 512 MB RAM | Fine for a small room, tight beyond that | Upgrade to Starter ($7) when revenue allows |
| Ephemeral filesystem | Only admin voice clips are files and are lost on redeploy | Re-upload clips in the admin panel after a deploy |
| 5 GB bandwidth / month | Enough for gameplay; watch heavy audio | Serve voice clips in compressed format |

The game must run as a **single instance** (rooms and timers live in memory), so do not enable
autoscaling on any host.

---

## 1. Create the database (Neon, free, no card)

1. Sign up at <https://neon.tech> (GitHub login works, no payment method asked).
2. Create a project, region **Frankfurt** (closest to Ethiopia among free options).
3. Copy the connection string. Use the **direct** hostname — the one *without* `-pooler` —
   because the container runs `prisma db push` on every boot:

   ```
   postgresql://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Keep it for step 3. The schema, seed and admin/agent accounts are created automatically on the
   first boot; there is nothing to run by hand.

> Supabase free (500 MB, pauses after ~1 week idle) also works if you prefer it — same
> `DATABASE_URL` shape, keep `?sslmode=require`. Neon is preferable because it does not pause.

## 2. Prepare your secrets

```bash
openssl rand -hex 32        # JWT_SECRET (or let Render generate it)
openssl rand -base64 18     # ADMIN_PASSWORD / AGENT_PASSWORD
```

Use passwords you are willing to lose — the seed writes them into the database on every boot.

## 3. Create the service from the blueprint

1. Push this repo to GitHub (already done).
2. Render Dashboard → **New** → **Blueprint** → select the repo → **Apply**.
   `render.yaml` creates one Docker web service named `ethio-bingo` in Frankfurt, free plan,
   health check on `/api/health`.
3. Render prompts for the `sync: false` values — paste:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon string from step 1 |
   | `PUBLIC_URL` | `https://ethio-bingo-xxxx.onrender.com` (exact host shown after creation) |
   | `CORS_ORIGIN` | same value as `PUBLIC_URL` |
   | `TELEGRAM_BOT_TOKEN` | from @BotFather |
   | `TELEGRAM_BOT_USERNAME` | e.g. `etioricabingo_bot` (no `@`, no `https://t.me/`) |
   | `ADMIN_PASSWORD`, `AGENT_PASSWORD` | from step 2 |
   | `DEPOSIT_TELEBIRR_ACCOUNT` / `_NAME`, `DEPOSIT_CBE_ACCOUNT` / `_NAME` | your deposit accounts |

4. Deploy. The first boot builds the web app, runs `prisma db push`, seeds settings and staff
   accounts, then starts the server. Watch the log for `Seed complete` and
   `listening on`.

If the URL is not known when the blueprint asks for it, deploy once with a placeholder, copy the
real `https://…onrender.com` from the dashboard, fix `PUBLIC_URL` and `CORS_ORIGIN`, and redeploy.
Wrong values here break Telegram auth and referral links — `DEV_MODE` must stay `false`.

## 4. Verify

```bash
curl https://ethio-bingo-xxxx.onrender.com/api/health
# {"ok":true,"time":"..."}

cd server
BASE_URL=https://ethio-bingo-xxxx.onrender.com npm run smoke
```

The smoke script exercises auth, the game endpoints and the WebSocket handshake against the live
service.

## 5. Keep it awake (free)

1. Create a free monitor at <https://uptimerobot.com> (HTTP(s), no card).
2. URL `https://ethio-bingo-xxxx.onrender.com/api/health`, interval **5 minutes**.
3. Do not ping `/`, `/robots.txt` or static files: Render answers those without waking the service.

Budget: 750 h/month against a ~744 h month, so this single service is all you get. A second free
web service would exhaust the allowance and both would stop before month end.

## 6. Point Telegram at it

In @BotFather:

- `/newapp` → pick your bot → set the Web App URL to the `https://…onrender.com` address, **or**
  `/myapps` → your app → *Edit Web App URL*.
- Mini Apps require HTTPS; the `onrender.com` certificate satisfies this, no domain purchase needed.
- `/setdomain` is only for the Login Widget and is not needed for a Mini App.

Open the bot, launch the Mini App, log in, and play one round. Admin panel: `/admin`, agent
dashboard: `/agent`.

## 7. Operating notes

- **Deploys** are triggered by pushes to `main` (`autoDeploy: true`). Each deploy wipes the container
  filesystem: re-upload voice clips afterwards. Balances, games and users live in Postgres and are
  unaffected.
- **Backups**: Neon free keeps a short point-in-time history; export a `pg_dump` from your machine
  regularly if the ledger matters:
  `pg_dump "$DATABASE_URL" > bingo-$(date +%F).sql`.
- **Sleeping mid-game**: if no traffic arrives for 15 minutes the process stops and in-flight rounds
  are lost. The 5-minute monitor prevents this; keep it running.
- **Outbound email** is blocked on free Render services. This app does not send email today, so this
  only matters if you add it later.
- **Growth**: when a room regularly fills, move to the $7 Starter instance (still one instance) or a
  ~$2–3/month VPS with the existing `docker-compose.prod.yml`.

## Local development

The canonical Prisma schema now targets PostgreSQL, but local development still uses SQLite:

```bash
npm run setup     # installs, generates prisma/schema.sqlite.prisma, pushes dev.db, seeds
npm run dev
```

`npm run db:sqlite` (in `server/`) regenerates the SQLite schema from `prisma/schema.prisma`, so the
models are edited in one place only. `prisma/schema.sqlite.prisma` is generated and git-ignored.

To run the **production** schema locally (parity check before deploying):

```bash
cd server
DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' npm run db:push
DATABASE_URL='postgresql://…' npm run seed
```
