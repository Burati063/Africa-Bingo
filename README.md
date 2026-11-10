# Africa Bingo — Telegram Mini App

A complete Ethiopian 75-ball bingo platform: a Telegram Mini App for players, a real-time
server-authoritative game engine, an admin panel for game/payment/agent control, and an agent
dashboard with referral commissions.

Stack: **React + Vite** (player app, admin, agent), **Node.js + Express + Socket.IO**, **Prisma**
(SQLite locally, PostgreSQL-ready), **JWT + Telegram initData** auth, server-side RNG / win
validation / wallet ledger.

---

## 1. Quick start

```bash
# 1. Install (already includes both workspaces)
npm install

# 2. Create your local env (already present in this workspace)
cp server/.env.example server/.env

# 3. Create the database and seed admin + demo agent
npm --workspace server run db:push
npm --workspace server run seed

# 4. Run API on :4000 and Vite on :5173
npm run dev
```

Open **http://localhost:5173** for the player app (dev login), **/admin** for the admin panel and
**/agent** for the agent dashboard.

Seeded accounts (change them in `server/.env`):

| Role  | Email            | Password     |
|-------|------------------|--------------|
| Admin | admin@bingo.et   | Admin@12345  |
| Agent | agent@bingo.et   | Agent@12345 (referral code `AGDEMO`) |

Local environment lives in `server/.env` (created for you, gitignored). `DEV_MODE=true` allows
browser login without Telegram; **never enable it in production**.

Production build:

```bash
npm run build      # builds web/dist, served by the API
npm start          # http://localhost:4000
```

---

## 2. Project structure

```
.
├── Dockerfile / docker-compose.yml / .dockerignore
├── package.json                  # npm workspaces + dev/build scripts
├── server
│   ├── .env.example
│   ├── prisma
│   │   ├── schema.prisma         # full database schema
│   │   └── seed.js               # defaults, admin, demo agent
│   ├── scripts/smoke.js          # end-to-end HTTP test (20 checks)
│   ├── test/payments.test.js     # parser + card/line tests
│   ├── uploads/voice/            # uploaded Amharic recordings (served at /uploads)
│   └── src
│       ├── index.js              # Express + Socket.IO + static web build
│       ├── engine.js             # rounds, calling, bots, claims, payouts
│       ├── bingo.js              # card generation, 12 winning lines
│       ├── wallet.js             # deposits, withdrawals, adjustments, agent payouts
│       ├── payments.js           # Telebirr / CBE SMS parsers
│       ├── agents.js             # attribution + commission calculations
│       ├── analytics.js          # admin KPIs, series, CSV exports
│       ├── settings.js           # cached platform settings
│       ├── auth.js               # Telegram HMAC, JWT, RBAC
│       ├── telegram.js           # broadcast via Bot API
│       ├── realtime.js / paths.js / util.js / db.js
│       └── routes
│           ├── auth.js           # player login, staff login
│           ├── player.js         # game, wallet, referral
│           ├── admin.js          # control, analytics, users, withdrawals, agents, voice
│           └── agent.js          # agent dashboard API
└── web
    ├── index.html                # Telegram WebApp SDK
    ├── vite.config.js            # /api, /uploads, /socket.io proxy
    └── src
        ├── main.jsx / App.jsx / styles.css
        ├── api.js / format.js / telegram.js
        ├── components/{Toast,StaffLogin,Charts}.jsx
        ├── player/{PlayerApp,TopBar,GameScreen,WalletScreen,WithdrawScreen}.jsx
        ├── admin/{AdminApp,Overview,GameControl,Users,Withdrawals,Agents,Audit}.jsx
        └── agent/AgentApp.jsx
```

---

## 3. Game mechanics

- 5×5 cards, columns **B 1–15, I 16–30, N 31–45, G 46–60, O 61–75**, free center.
- 12 winning lines (5 rows, 5 columns, 2 diagonals). Cards are auto-marked from the server's called
  numbers; the player only presses **Bingo!**.
- Round lifecycle: `WAITING` (entry window, countdown) → `CALLING` (one number every
  `callIntervalMs`) → `ENDED` (result + next-round countdown).
- The server owns the shuffled deck, cards, calls and validation. A false claim blocks that player
  for the rest of the round; repeated claims return an error.
- Payout: real stakes − platform fee = prize pool. All real players holding a complete line when the
  round ends split the pool equally (cents are floored). A bot may trigger the end of the round, but
  **bots never receive real money** — only real winners are credited.
- Bots join each round per admin setting (0–50), with random names and cards. They claim with a
  1.5–4 s human-like delay. With a forced human winner, bots are held until that player claims (or
  the deck runs out).
- Card numbers are **1–432**. A player picks specific numbers during the 30-second waiting window
  and each pick costs 20 ETB (the configured stake), charged immediately and atomically. A number
  can only be bought once per round by anyone, and a player may buy as many numbers as they can
  afford until the window closes.
- If no real player holds a line, the round ends with no cash payout (stakes remain platform
  revenue).
- All picks are deducted atomically before a card is assigned; if the server restarts mid-round the
  engine **refunds every real stake** from the interrupted round.

Money is stored as **integer santim** (1 ETB = 100 santim) everywhere.

---

## 4. Player Mini App

- **Top bar:** balance, Derash points, players, stake per card, current call.
- **B I N G O master board:** every called number, latest call highlighted.
- **Cards:** auto-marked, horizontally scrollable for multi-card purchases.
- **Actions:** pick numbered cards 1–432 (tap = buy that number for 20 ETB), live spent/prize
  estimate before the call, big Bingo! claim button, 30-second selection countdown, winner banner.
- **Wallet:** available balance, transaction history (with the exact empty state copy), Telebirr and
  CBE deposit methods with the exact Amharic instructions, then receipt-link verification.
- **Withdrawal:** the exact Amharic manual-withdrawal notice, amount, bank, account number, holder
  name, live summary panel (`PENDING APPROVAL`, `15 - 30 Minutes`), submit button, history.
- **Voice:** static audio files fetched from `/api/voice-files`, played for each called number;
  toggle in the game header (also globally disableable by admins).
- **Agent tab** appears for agent-role players and links to the agent dashboard.

All Amharic strings from the specification are used verbatim in `WalletScreen.jsx` /
`WithdrawScreen.jsx`.

### Telegram setup

1. Create a bot with **@BotFather**, copy the token to `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_BOT_USERNAME` (without `@`) and a public HTTPS `PUBLIC_URL`.
   Full step-by-step instructions are in [`RUN.md`](./RUN.md).
3. In BotFather: `/newapp` (or Menu Button) → set the Mini App URL to your deployed HTTPS URL.
4. Referral links are generated as `https://t.me/<bot>?start=<CODE>`; the app reads
   `start_param`/`?start=` and links the user permanently to that agent.

With no bot token, the server runs in `DEV_MODE` for local browser testing and reports broadcasts as
simulated.

---

## 5. Payments

### Deposit verification

There is **no Chapa and no payment gateway integration**. The player pays the platform Telebirr/CBE
account directly, then pastes the **receipt link** the provider gave them:

`POST /api/wallet/deposit/verify-link` `{link}`

`server/src/receipts.js` fetches that official receipt page/API server-side and reads the amount,
status, transaction reference and receiving account. Verification rules:

- only official hosts are fetched (`transactioninfo.ethiotelecom.et`, `mbreciept.cbe.com.et`,
  `mb.cbe.com.et`, `cbepay1.cbe.com.et`) over HTTPS — user-supplied URLs are never fetched blindly;
- the money must have gone to the configured account (`DEPOSIT_TELEBIRR_ACCOUNT` /
  `DEPOSIT_CBE_ACCOUNT`, defaulting to `0972449537` (Leul) and `1000574677487` (SILMA));
- the receipt reference is unique — resubmitting the same receipt returns `409`;
- amounts up to `maxAutoVerify` are credited instantly and the wallet/ledger updated;
- unreadable pages, CBE PDF receipts, account mismatches and amounts above the threshold create a
  `PENDING_REVIEW` deposit, approved or rejected in **Admin → Withdrawals → Deposit review** (the
  admin sees the receipt link and can enter the amount);
- every credit calls the agent commission engine.

Telebirr's receipt page is sometimes reachable only from Ethiopian networks and CBE's public API
headers are undocumented; both failures fall back to manual review rather than crediting money, and
`CBE_APP_ID` / `CBE_APP_VERSION` can override the headers. The legacy SMS parser
(`POST /api/wallet/deposit/verify`, `server/src/payments.js`) only exists behind the `smsAllowed`
setting / `ALLOW_SMS_VERIFICATION=true` and is off by default.

Withdrawals are always manual: request reserves the balance, admin sends money, then approves
(rejection refunds automatically).

---

## 6. Agent referral & commissions

Attribution is permanent (`users.referredByAgentId` + `referrals` row) and self-referral is blocked.
Rates are editable in **Admin → Game Control → Agent commission settings**:

| Event | Formula | Default |
|-------|---------|---------|
| Deposit bonus | `floor(depositSantim / 2000) * agentPer20Bonus` | 1 ETB per 20 ETB, all deposits |
| Activity bonus | once, when `activeReferralCount >= agentActivityThreshold` | 3 ETB at 3 active users |
| Gameplay commission | `stake * platformFeeRate * agentGameplayCommissionRate` | 5% of platform fee |
| Minimum agent withdrawal | `agentMinWithdraw` | 50 ETB |

A referred user becomes “active” on their first paid stake. Every credit lands in
`agent_transactions`, increases `commissionBalance`/`totalEarned`, and is visible to the agent and
the admin. Agent withdrawals use the same reserve → approve/reject flow as player withdrawals.

**Agent dashboard (`/agent`):** referral link with copy button, overview KPIs, referral table with
masked names and per-user deposits/games/commission, full commission ledger, withdrawal form and
history, marketing messages.

**Admin agent tools:** promote any user (creates agent login + permanent code), list performance,
enable/disable, adjust commission balance with reason, review pending agent withdrawals, inspect
referral downline and ledger.

---

## 7. Admin panel

- **Overview:** deposits, withdrawals, platform fees, agent commissions, net revenue, prize payouts,
  players, active daily/weekly/monthly, rounds, average stake/players, biggest win, GMV, 14-day line
  and bar charts, money-flow donut, pending queues, CSV exports.
- **Game control:** live round state (status, players, calls, pool, timer, forced winner, real
  players and their bingo state), game settings (stake, bots 0–50, wait time, call interval, round
  delay, fee %, auto-start, global voice, min withdrawal, auto-verify limit), start round now,
  audited next-winner override (specific player or a bot), Telegram broadcast, voice upload/list.
- **Users:** search, balances, referral info, expandable detail with ledger/games/referrals,
  audited balance adjustments, ban/unban.
- **Withdrawals:** player/agent tabs with approve/reject + notes, plus deposit manual review.
- **Agents:** promote, list, enable/disable, adjust, full downline and ledger.
- **Audit log:** every sensitive action (settings, overrides, adjustments, approvals, broadcasts,
  voice changes, round creation/winner override usage).

---

## 8. API reference

All authenticated routes use `Authorization: Bearer <JWT>`.

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/telegram` | `{initData}` or dev `{devTelegramId,startParam}` → player JWT + user |
| POST | `/api/auth/staff/login` | email/password → admin or agent JWT |
| GET | `/api/auth/staff/me` | current staff account |

### Player
| Method | Path |
|---|---|
| GET | `/api/me` (user, agent info, config, wins today, pending items) |
| GET | `/api/game/state` (public state + your cards) |
| POST | `/api/game/join` `{cards:[1..432]}` (one entry = one 20 ETB pick) |
| POST | `/api/game/claim` |
| GET | `/api/game/history` |
| GET | `/api/wallet/transactions` · `/wallet/deposits` · `/wallet/withdrawals` |
| POST | `/api/wallet/deposit/verify-link` `{link}` (Telebirr/CBE receipt link) |
| POST | `/api/wallet/deposit/verify` `{sms}` (legacy, off by default) |
| POST | `/api/wallet/withdrawals` `{amount,bank,accountNumber,accountName}` |
| GET | `/api/my-referral` |
| GET | `/api/voice-files` (public) |

### Admin (`/api/admin`, role `admin`)
`GET /overview`, `GET/PATCH-ish /settings` (`PUT`), `GET /users`, `GET /users/:id`,
`POST /users/:id/adjust`, `POST /users/:id/ban`, `GET /withdrawals`,
`POST /withdrawals/:id/approve|reject`, `GET /deposits`, `POST /deposits/:id/approve|reject`,
`GET /agent-withdrawals`, `POST /agent-withdrawals/:id/approve|reject`,
`GET /agents`, `GET /agents/:id`, `POST /agents/promote`, `POST /agents/:id/toggle`,
`POST /agents/:id/adjust`, `GET /game/state`, `POST /game/start`, `POST /game/next-winner`,
`POST /broadcast`, `GET/POST /voice`, `DELETE /voice/:id`, `GET /audit`, `GET /export?type=users|transactions|withdrawals|agents`.

### Agent (`/api/agent`, role `agent`)
`GET /me`, `GET /referrals`, `GET /earnings`, `GET /withdrawals`, `POST /withdrawals`.

### WebSocket (Socket.IO)
Auth via `auth.token` (player JWT). Events emitted by the server:
`state` (public round snapshot), `you` (your cards/claim block/win), `number` (new call),
`game:started`, `game:ended` (winners + ids), `balance`, `agent:balance`.

---

## 9. Database schema

`server/prisma/schema.prisma` defines:

- `User` (telegram id, balance, derash, role, `referredByAgentId`, ban/played flags)
- `Agent`, `Referral`, `AgentTransaction`, `AgentWithdrawal`, `StaffAccount`
- `Game`, `GamePlayer` (cards JSON, bot flag, win), `CalledNumber`
- `Transaction` (deposit/withdrawal/stake/win/refund/adjustment ledger)
- `Deposit`, `Withdrawal` (manual approval flow)
- `PlatformSetting` (fees, timers, bot count, commission rates, next winner)
- `VoiceFile`, `AdminAction`

Local development uses SQLite via `prisma db push`. To scale on PostgreSQL: change
`provider = "postgresql"` in `schema.prisma`, point `DATABASE_URL` at Postgres, then run
`npx prisma migrate dev --name init` (or `prisma migrate deploy` in CI).

---

## 10. Real-time & scale notes

The round lives in one process (Node memory) with every call persisted to `called_numbers`. This is
ideal for one container. For horizontal scaling, move the engine to a single worker and use the
Socket.IO Redis adapter + a shared store; stake/win movements are already transactional and safe.

---

## 11. Security & fraud prevention

- Telegram `initData` HMAC checked against the bot token, with 24 h freshness; JWT is role-scoped.
- `DEV_MODE` bypass is disabled in the Docker compose default.
- All RNG, cards, calls, claims and payouts are server-side; the client only renders state.
- Atomic conditional balance updates (no negative balances / double spends), unique transaction refs.
- Rate limits on login and deposit verification; 1 MB JSON limit; helmet; CORS allow-list.
- Admin actions are audited; withdrawals and balance changes carry reasons.
- Referral guards: self-referral rejected, disabled agents cannot attract new referrals, attribution
  cannot be overwritten, downline names masked for agents.
- **Operational gaps to close before real money:** provider webhook verification instead of SMS
  pattern matching, KYC/AML policy, device/IP referral-fraud checks, 2FA for admins, audit-log
  retention, HTTPS-only deployment, and backup/restore for the ledger.

---

## 12. Docker deployment

See **[DEPLOY.md](./DEPLOY.md)** for the full production roadmap (VPS, HTTPS, Telegram setup,
backups, monitoring and scale path). Quick version:

```bash
cp server/.env.example .env   # fill in real secrets
docker compose up --build -d
```

The container runs `prisma db push`, seeds admin/agent idempotently, then starts the API and serves
the built web app on port 4000. SQLite data and uploaded voice files live in named volumes.
Set `DEV_MODE=false`, a strong `JWT_SECRET`, `PUBLIC_URL`, `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_BOT_USERNAME`. Put the container behind HTTPS (Caddy/nginx/Cloudflare) — Telegram requires
HTTPS for Mini Apps.

---

## 13. Voice files

Admins upload static recordings per number (`num_1`…`num_75`) or announcement (`bingo`,
`game_start`) in **Game Control → Voice files**. The player app maps the last called number to
`num_<n>` and plays it when voice is on. When a number has no uploaded recording, the app uses an
installed Amharic voice (`am-ET`) via the Web Speech API; if the device has no Amharic voice (common
in mobile WebViews), it streams the Amharic call audio instead. Players can also tap any call in the
`ጥሪዎች` rail to hear it again.
Uploads accept mp3/ogg/wav/m4a up to 5 MB
and are stored in `server/uploads/voice`, served from `/uploads/voice/...`. The repository ships with
no audio assets — record the Amharic numbers once and upload them.

---

## 14. Verification performed

- `npm --workspace server test` — 22/22 (payout split, card/line logic, agent commission rules,
  receipt-link parsing and review routing).
- `npm --workspace web run build` — Vite production build succeeds.
- `npm --workspace server run smoke` — 22/22 end-to-end checks against a live server: health, admin
  login, settings update, referral registration, receipt link sent to review, duplicate receipt
  rejection, admin approval credit, agent deposit bonus, waiting round, join/stake deduction, Bingo
  claim, win payout, ledger entries, agent gameplay commission, admin analytics.

The smoke test flips the game to a fast, bot-free round and restores the defaults afterwards.
