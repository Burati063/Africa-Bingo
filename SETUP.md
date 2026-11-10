# Africa Bingo — Setup Steps

Everything needed to run the app locally and open it as a real Telegram Mini App.
Commands are **bash** (Git Bash on Windows). Run them from the repository root.

> The broader feature/run guide is in [`RUN.md`](./RUN.md). This file is the ordered setup checklist.

---

## 0. What is already running here

| Item | Value |
|---|---|
| Server | `http://localhost:4000` (serves API + `web/dist`) |
| Public HTTPS tunnel | `https://normal-dishes-dance-joe.trycloudflare.com` |
| Tunnel binary | `tools/cloudflared.exe` (already downloaded) |
| Database | `server/prisma/dev.db` (SQLite, seeded) |

The tunnel URL changes every time the tunnel restarts — update it in BotFather and in
`server/.env` → `PUBLIC_URL` when that happens.

---

## 1. Prerequisites

- Node.js 20+ (`node -v`)
- Git Bash on Windows
- Telegram account (only for step 6+)

---

## 2. Install dependencies

```bash
npm install
```

---

## 3. Create the database and seed accounts

```bash
cd server
npx prisma db push
npx prisma generate
npm run seed
cd ..
```

Seeded logins:

| Role | Login | Password |
|---|---|---|
| Admin | `admin@bingo.et` | `Admin@12345` |
| Agent | `agent@bingo.et` | `Agent@12345` (referral code `AGDEMO`) |

Reset everything later with `rm server/prisma/dev.db` and repeat this step.

---

## 4. Configure `server/.env`

Minimum working file:

```ini
PORT=4000
NODE_ENV=development
JWT_SECRET=change-me-to-a-long-random-string
DATABASE_URL="file:./dev.db"
PUBLIC_URL=http://localhost:4000
DEV_MODE=true

# Telegram — fill in after step 6
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=

# Deposit receipt verification (also the built-in defaults)
DEPOSIT_TELEBIRR_ACCOUNT=0972449537
DEPOSIT_TELEBIRR_NAME=Leul
DEPOSIT_CBE_ACCOUNT=1000574677487
DEPOSIT_CBE_NAME=SILMA

ADMIN_EMAIL=admin@bingo.et
ADMIN_PASSWORD=Admin@12345
AGENT_EMAIL=agent@bingo.et
AGENT_PASSWORD=Agent@12345
```

---

## 5. Start the app

```bash
npm run build     # builds web/dist — required after every frontend change
npm start         # http://localhost:4000
```

Check locally:

- Player: <http://localhost:4000/>
- Admin: <http://localhost:4000/admin>
- Agent: <http://localhost:4000/agent>
- Health: <http://localhost:4000/api/health>

`DEV_MODE=true` lets a browser sign in without Telegram (random dev identity in `localStorage`), so
you can test joining rounds, deposits and withdrawals before touching Telegram.

---

## 6. Create the Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`.
3. Choose a display name, e.g. `Africa Bingo`.
4. Choose a username ending in `bot`, e.g. `EthioBingoBot`.
5. BotFather replies with a token like `123456789:AAE-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

Put the token in `server/.env`:

```ini
TELEGRAM_BOT_TOKEN=123456789:AAE-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_BOT_USERNAME=EthioBingoBot
DEV_MODE=false
```

`DEV_MODE=false` makes the server reject unsigned logins; only real Telegram `initData` works.

---

## 7. Start the public HTTPS tunnel

Telegram only opens Mini Apps from public HTTPS URLs, so `localhost` cannot be registered directly.

With the binary already in this repo:

```bash
./tools/cloudflared.exe tunnel --url http://localhost:4000 --no-autoupdate
```

It prints a URL like:

```
https://normal-dishes-dance-joe.trycloudflare.com
```

Copy that URL into `server/.env`:

```ini
PUBLIC_URL=https://normal-dishes-dance-joe.trycloudflare.com
```

Then restart the server (`Ctrl+C`, then `npm start`). Verify the tunnel:

```bash
curl https://normal-dishes-dance-joe.trycloudflare.com/api/health
# {"ok":true,...}
```

<details>
<summary>Using ngrok instead</summary>

```bash
ngrok http 4000
```

Use the printed `https://....ngrok-free.app` URL the same way.
</details>

---

## 8. Register the Mini App in BotFather

1. Send `/newapp`.
2. Pick your bot.
3. Title: `Africa Bingo`; short description; upload a 640×360 image.
4. **Web App URL:** the tunnel URL from step 7 (no trailing path needed).
5. Optional menu button — `/setmenubutton` → pick bot → URL = tunnel URL → button text `Play Bingo`.
6. Optional commands — `/setcommands` → `start - Open Africa Bingo`.

---

## 9. Verify inside Telegram

1. Open your bot in Telegram.
2. Tap **Start** (or the menu button).
3. The Mini App loads `/`, calls `Telegram.WebApp.ready()` / `.expand()`, and posts `initData` to
   `POST /api/auth/telegram`.
4. You should see the game board with your balance in the top bar.

Functional checks inside Telegram:

- Wait for a round → **Join round** → the stake is deducted and cards appear.
- Tap **Bingo!** when a line completes.
- **Wallet → Deposit:** pay the displayed Telebirr/CBE account, paste the receipt link, tap
  **Verify & add funds**.
- Referral link: `https://t.me/<your_bot>?start=AGDEMO`.

If you see "Could not sign in", the `initData` was rejected: check that `TELEGRAM_BOT_TOKEN` belongs
to the bot you opened and that the server was restarted after editing `.env`.

**Important:** I cannot open Telegram for you, so the final tap-through has to happen on your phone
or desktop Telegram client.

---

## 10. Deposit verification defaults

No Chapa / payment gateway. The player pays the platform account and pastes the official receipt
link; the server fetches it and credits only if the receiving account matches.

| Provider | Account | Name |
|---|---|---|
| Telebirr | `0972449537` | Leul |
| CBE | `1000574677487` | SILMA |

- Only official receipt hosts are fetched over HTTPS.
- Duplicate receipt link → `409`.
- Unreadable / PDF / mismatched receipts → `PENDING_REVIEW` in **Admin → Withdrawals → Deposit review**.
- Transient failures (provider unreachable, payment still settling, amount not yet readable) are
  re-checked automatically with backoff (`RECEIPT_RETRY_MAX`, default 5 attempts; first check after
  `RECEIPT_RETRY_BASE_MS`, default 60 s). A receipt that becomes readable and matches the platform
  account is credited without admin action; wrong-account and over-limit receipts go straight to
  manual review.
- Admin approval credits the wallet and pays agent commission.

---

## 11. Checks

```bash
cd server
node --test     # 33 tests: payouts, cards, referral rules, receipts, auto-retry, withdrawals
npm run smoke   # 22 end-to-end API checks against the running server
```

---

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE :::4000` | `netstat -ano \| grep ':4000'` then `taskkill //PID <pid> //F` |
| Admin/agent login fails | Re-run `npm run seed` from `server` |
| Blank page in Telegram | Tunnel stopped or BotFather URL is stale — restart tunnel, update URL in BotFather and `PUBLIC_URL` |
| "Could not sign in" in Telegram | Wrong bot token, or `DEV_MODE`/token changed without restarting the server |
| Wallet screen shows old SMS box | `npm run build`, then restart the server |
| Deposit stuck in review | Receipt not payable to the configured account, PDF receipt, or provider page unreachable from the server |
