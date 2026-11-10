# Running Africa Bingo (local + Telegram Mini App)

Step-by-step instructions to run the player Mini App, admin panel and agent dashboard, and to open
the app inside Telegram.

Money is stored as integer **santim** (1 ETB = 100 santim). Stack: React + Vite frontend,
Node/Express + Socket.IO backend, Prisma + SQLite locally.

---

## 1. Prerequisites

- **Node.js 20+** and npm (`node -v`).
- **Git Bash** on Windows (all commands below are bash syntax).
- Optional for the Telegram step: a Telegram account and a public HTTPS URL (Cloudflare Tunnel or
  ngrok — both are free).

---

## 2. Install

From the repository root:

```bash
npm install
```

This installs the root workspace plus `server` and `web`.

---

## 3. Configure the server

Create `server/.env` (copy `server/.env.example`). The defaults below work out of the box:

```ini
PORT=4000
NODE_ENV=development
JWT_SECRET=change-me-to-a-long-random-string
DATABASE_URL="file:./dev.db"
CORS_ORIGIN=http://localhost:5173

# Telegram (fill these only for the real Mini App, see step 7)
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
PUBLIC_URL=http://localhost:5173
DEV_MODE=true

# Deposit receipt verification — these are also the built-in defaults
DEPOSIT_TELEBIRR_ACCOUNT=0972449537
DEPOSIT_TELEBIRR_NAME=Leul
DEPOSIT_CBE_ACCOUNT=1000574677487
DEPOSIT_CBE_NAME=SILMA

# Seeded accounts
ADMIN_EMAIL=admin@bingo.et
ADMIN_PASSWORD=Admin@12345
AGENT_EMAIL=agent@bingo.et
AGENT_PASSWORD=Agent@12345
```

The deposit accounts are enforced: a receipt is only credited when the money was sent to
`DEPOSIT_TELEBIRR_ACCOUNT` (Telebirr) or `DEPOSIT_CBE_ACCOUNT` (CBE / CBE Birr). If you change the
phone/account, update these values (and the account instructions shown in the wallet screen in
`web/src/player/WalletScreen.jsx`).

---

## 4. Create the database and seed accounts

```bash
cd server
npx prisma db push
npx prisma generate
npm run seed
cd ..
```

`npm run seed` creates:

| Role | Login | Password |
|---|---|---|
| Admin | `admin@bingo.et` | `Admin@12345` |
| Agent | `agent@bingo.et` | `Agent@12345` (referral code `AGDEMO`) |

Reset to a clean database at any time with `rm server/prisma/dev.db` and repeat this step.

---

## 5. Start the app

### Production-style (one server, recommended)

```bash
npm run build     # builds web/dist
npm start         # server on http://localhost:4000
```

Open:

- Player Mini App: <http://localhost:4000/>
- Admin panel: <http://localhost:4000/admin> (`admin@bingo.et` / `Admin@12345`)
- Agent dashboard: <http://localhost:4000/agent> (`agent@bingo.et` / `Agent@12345`)

The server serves `web/dist` and the API/Socket.IO on the same port, so no separate frontend server
is needed.

### Development with hot reload

```bash
npm run dev        # server :4000 + Vite :5173 in parallel
```

Open <http://localhost:5173>. Rebuild `web/dist` (`npm run build`) before switching back to
`npm start` so the server serves the latest frontend.

---

## 6. Test the app without Telegram

`DEV_MODE=true` lets the browser sign in without Telegram `initData`. The app keeps a stable dev
identity in `localStorage` (`bingo_dev_id`), creates the player on first load, and everything works
normally: joining rounds, wallet, withdrawals.

1. Open <http://localhost:4000/>.
2. The game auto-starts a round every 20 s with 8 bots (change in **Admin → Game Control**).
3. **Wallet → Deposit:** pay the displayed Telebirr/CBE account, then paste the **receipt link**
   (e.g. `https://transactioninfo.ethiotelecom.et/receipt/XXXXXXXX`) and press **Verify & add funds**.
   A Telebirr transaction number (`CIM220JG60`) is also accepted.
4. If a receipt cannot be read automatically (CBE PDF, geo-blocked page, wrong account, amount above
   `maxAutoVerify`), the deposit becomes `PENDING_REVIEW` and the player sees "sent to admin review".
   Transient failures are re-checked in the background with exponential backoff before an admin has to
   act (`RECEIPT_RETRY_INTERVAL_MS`, `RECEIPT_RETRY_MAX`, `RECEIPT_RETRY_BASE_MS`).
5. **Admin → Withdrawals → Deposit review** shows the receipt link; approve with the real amount to
   credit the wallet, or reject with a note.

With `DEV_MODE=false` the browser login is refused and only requests signed by real Telegram
`initData` work.

### Automated checks

```bash
cd server
node --test          # 33 unit tests: payouts, cards, referral rules, receipts, auto-retry, withdrawals
npm run smoke        # 22 end-to-end API checks against a running server
```

The smoke test needs the server already running on `http://localhost:4000` (override with
`BASE_URL`). It temporarily switches the game to a fast, bot-free round and restores the defaults.

---

## 7. Put it inside Telegram (real Mini App)

Telegram only opens Mini Apps from a **public HTTPS URL**, so `localhost` cannot be used directly.

### 7.1 Create the bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram → `/newbot`.
2. Choose a name and a username ending in `bot` (e.g. `EthioBingoBot`).
3. Copy the **token** (looks like `123456789:AAE...`) into `server/.env`:

```ini
TELEGRAM_BOT_TOKEN=123456789:AAE...
TELEGRAM_BOT_USERNAME=EthioBingoBot
DEV_MODE=false
```

### 7.2 Expose the app over HTTPS

Pick one tunnel and keep it running:

**Cloudflare Tunnel (free, no account needed for quick tunnels):**

```bash
cloudflared tunnel --url http://localhost:4000
# prints e.g. https://random-words-1234.trycloudflare.com
```

**ngrok:**

```bash
ngrok http 4000
# prints e.g. https://abcd-1234.ngrok-free.app
```

The tunnel points at port **4000** because that server serves both the API and `web/dist`.

Set the printed URL in `server/.env` and restart the server:

```ini
PUBLIC_URL=https://random-words-1234.trycloudflare.com
```

### 7.3 Register the Mini App with BotFather

1. `/newapp` → choose your bot → title `Africa Bingo` → description → upload a 640×360 image.
2. **Web App URL:** your tunnel URL (`https://random-words-1234.trycloudflare.com`).
3. Optional: `/setmenubutton` → choose the bot → URL `https://random-words-1234.trycloudflare.com`
   → button text `Play Bingo`. The app then opens from the chat menu button.
4. Optional: `/setcommands` → `start - Open Africa Bingo`.

### 7.4 Test inside Telegram

1. Open your bot in Telegram and press **Start** / the menu button.
2. The Mini App loads `<your-https-url>/`; the app calls `Telegram.WebApp.ready()` /
   `.expand()` and sends `initData` to `POST /api/auth/telegram`.
3. Play: wait for a round, **Join**, tap **Bingo!** when a line completes.
4. Referrals: share `https://t.me/<your_bot>?start=AGDEMO`; new users are linked to that agent once.

If the app shows "Could not sign in", the `initData` was rejected — check that
`TELEGRAM_BOT_TOKEN` matches the bot whose Mini App you opened and that `DEV_MODE=false`.

### 7.5 Notes and limitations

- Telegram requires HTTPS; a free quick tunnel URL changes every restart. Re-set the Mini App URL in
  BotFather (or use a named tunnel / real domain) after each restart.
- `initData` is validated with the bot token on the server; tokens and `JWT_SECRET` must stay secret.
- Telebirr receipt pages are sometimes reachable only from Ethiopian networks. When the server
  cannot fetch a receipt it routes the deposit to admin review instead of crediting it; approve it
  manually after checking the link.
- Withdrawals are always manual: the request reserves the balance, the admin sends the money, then
  approves (rejection refunds automatically).

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE :::4000` | An old server is still running: `netstat -ano \| grep ':4000'` then `taskkill //PID <pid> //F`. |
| Admin/agent login fails | Re-run `npm run seed` (from `server`). |
| Prisma "database is locked" / missing tables | Stop the server, run `npx prisma db push` in `server`. |
| Wallet screen still shows the old SMS box | Rebuild the frontend: `npm run build`, then restart the server. |
| Telegram opens a blank page | The tunnel is down or the BotFather URL is stale; restart the tunnel and update the URL. |
| Deposit always goes to review | Receipt not payable to the configured account, PDF receipt, or provider page not reachable — check `server` logs and the admin review row. |
