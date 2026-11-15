# Handoff: FaZe Collector Cards (HackUTA 2026, FaZe track)

Written 2026-11-15 by Jaideep's Claude (Agent C, fan client). It covers what is built, what was verified, what can still break the demo, and what to build next. All of it was checked against the code on `main` at `cfe2ebc`, plus branch `agent-c/demo-fixes`, while the stack ran against a live Tiger Cloud database.

> Before you change anything, read `AGENTS.md` (board rules, folder ownership) and `master.md` (product rules). The contract (`docs/api.md`, `docs/data-model.md`, `packages/shared`) is frozen. Only the lead, @Abhijith-utla, changes it, and changes are announced on the board (pinned issue #1, `tools/board`).

---

## 1. Project in one paragraph

Fans collect digital trading cards of FaZe members and moments. They sign up and get 500 demo coins. They open packs with published odds, build a collection with serial numbers, trade cards with other fans and climb a leaderboard. They buy more coins with **devnet SOL through the Phantom wallet** (test payments, no real value). Card "hype" reacts to simulated creator engagement. Staff publish new sets and moderate user content in an admin app. The server is authoritative for pulls, odds, balances, trades and payments; the client only renders results.

## 2. Team and ownership

| Area | Owner | Folders |
|---|---|---|
| Lead: contract, docs, merges, root config, board tooling | @Abhijith-utla | `master.md`, `README.md`, `AGENTS.md`, `docs/`, `agents/`, `packages/shared/`, root config, `tools/`, `.claude/`, `.github/` |
| A: Core API and game economy | @toosh-legacy | `services/api/` (also owns **all** DB migrations) |
| B: Payments and integration QA | @Abhijith-utla | `services/payments/`, `tests/integration/` |
| C: Fan client (web and mobile) | @Jaideepo7 | `apps/client/` |
| D: Content pipeline and moderation | @tanejakeshav | `services/worker/`, `apps/admin/`, `content/seed/` |

Rules that matter in practice:
- **Stay in your folders.** To change someone else's files, ask for a handoff on the board and wait for the owner or the lead.
- **Workflow:** work on your own branch, run `npm run typecheck && npm test`, merge `origin/main` in, then fast-forward `main` or open a PR. Post what landed on the board.
- **Board posts** start with `[<Name>'s Claude]`, and mention people by GitHub login.

## 3. Key decisions (and why)

| Decision | Status | Notes |
|---|---|---|
| **Payments: Phantom + Solana devnet, not Stripe** | Decided by Abhijith (lead), contract v1.1 | Stripe was the original plan and has been removed completely. Devnet SOL is a test payment and coins can't be cashed out. Mainnet is refused at boot. |
| **Server verifies payments on-chain** | Implemented | The client never reports a payment as successful. The payments service reads the transaction from Solana RPC and checks the reference key, the treasury recipient and the amount, and that the signature hasn't already been used. Only then does it credit coins through the API's internal ledger. |
| **Database: one shared PostgreSQL** | Implemented | Accessed through a server-only `DATABASE_URL`. Migrations live in `services/api/migrations/` and run on API boot. |
| **Tiger Cloud (managed Postgres) for hosting** | **Pending lead decision** in `agents/lead.md` | The code supports it (`sslmode=require` is enforced for remote hosts). Jaideep's local `.env` already points at a Tiger Cloud service, and it's migrated and seeded. |
| **`artUrl` is stored and returned relative** (`/art/<id>.<ext>`) | Contract v1.5 (supersedes v1.4 "absolute") | Clients resolve it with `new URL(artUrl, API_BASE)`. Card art moves into a `card_art` table (migration 002). Assigned to @toosh-legacy. |
| **Trade picker user search** `GET /users?q=` | Contract v1.2 | Returns approved display names only, max 10. |
| **Fan-art submissions** `POST /submissions/fan-art` | Contract v1.4 | Image bytes stay private in moderation until staff approve. |

## 4. What is implemented

### 4.1 Core API: `services/api` (Fastify + pg, port 4000)
- **Auth:** `POST /auth/signup|login|logout`, `GET /me`.
  - bcrypt password hashes.
  - JWT (HS256) in an httpOnly `session` cookie: 7 days, SameSite=Lax, Secure in production.
  - Signup grants 500 demo coins through the ledger and queues the display name for moderation.
- **Ledger:** append-only `ledger` table. Balance is the sum of the user's entries.
  - `postEntry` is idempotent on `idempotency_key`.
  - It serializes each user with `SELECT … FOR UPDATE` and refuses to go negative.
  - `POST /internal/ledger/credit` (header `X-Internal-Secret`) is used by payments.
- **Packs:** `GET /packs` lists active packs in live sets. `POST /packs/:id/open {idempotencyKey}`:
  - rolls rarity with a CSPRNG (`crypto.randomInt`) against the published odds;
  - honours `max_supply`: if the rolled card is sold out it rerolls within the same rarity, then falls to lower rarities, then returns 409;
  - gives each card instance a unique serial (`UNIQUE(card_id, serial)`), assigned under row locks on the set's cards;
  - logs every pull with the odds version used;
  - is replay-safe: the same idempotency key returns the same pull without a second charge.
- **Collection:** `GET /me/cards`, `GET /users/:id/collection`, `GET /cards/:id` (with hype), `GET /users?q=`.
- **Trades:** `POST /trades`, `GET /me/trades`, `POST /trades/:id/accept|decline|cancel`.
  - Cards are locked (`locked_by_trade_id`) when an offer is made.
  - On accept, ownership is re-checked and both sides swap in one transaction.
  - Trade messages go to moderation and are hidden from the recipient until approved.
- **Leaderboard:** score is the sum over owned instances of rarity weights (common 1, rare 3, epic 10, legendary 25). Trending is the top 10 cards by hype.
- **Admin** (role `admin`):
  - Sets: CRUD. Publish validates cards, art and an active pack whose odds sum to 100, then queues a `publish_set` job.
  - Cards and packs: CRUD. Changing a pack's odds bumps its `odds_version`.
  - Moderation queue: approve or reject.
  - Engagement spike: queues an `engagement_spike` job.
  - Art upload `POST /admin/art`: PNG, JPEG or WebP, max 2 MB, magic bytes checked against the MIME type. The file is written to local disk (see §6.1).
- **Seed** (`npm run seed -w @faze/api`): idempotent.
  - Creates `admin@demo.faze / demo-admin-pass` and `fan1..4@demo.faze / demo-fan-pass`.
  - Imports `content/seed/catalog.json`: 3 sets, 40 cards, 3 packs, all labelled demo.
- **Test-database guard:** API tests require a `TEST_DATABASE_URL` that differs from `DATABASE_URL`, so tests can never wipe the real database.

### 4.2 Payments: `services/payments` (Fastify, port 4100)
- **Bundles** (`GET /payments/bundles`):

  | Bundle | Price |
  |---|---|
  | 1,000 coins | 0.05 devnet SOL |
  | 2,500 coins | 0.1 devnet SOL |
  | 6,000 coins | 0.2 devnet SOL |

  The response also carries `cluster`, `recipient` (the treasury) and `testMode: true`.
- **Checkout** (`POST /payments/checkout {bundleId}`): creates a pending purchase with a fresh Solana Pay reference key. Returns `{purchaseId, recipient, lamports, reference, cluster, solanaPayUrl}`.
- **Confirm** (`POST /payments/confirm {purchaseId, signature?}`):
  - verifies the transaction on-chain;
  - reserves the signature on the purchase row (unique constraint), which blocks reuse and a race between two purchases sharing one transaction;
  - credits through the API ledger with idempotency key `purchase:<id>`;
  - marks the purchase paid.
  - Returns 409 when the transaction isn't confirmed yet; the client retries every 2 s.
- **Reconcile loop:** every `PAYMENT_RECONCILE_INTERVAL_SECONDS` (15 s) it catches purchases that were paid on-chain but never confirmed, e.g. because the tab was closed.
- **Test switches:** `PAYMENTS_SIMULATE=1` accepts fake signatures `sim_<reference>_<lamports>` and is refused in production. `PAYMENTS_STANDALONE=1` runs in memory, without Postgres or the API.
- **Tests:** 26 unit tests pass (replay, reused signature, underpayment, wrong recipient, missing reference, failed transaction, another user's purchase, mainnet refused).

### 4.3 Worker: `services/worker` (Node, plain `.mjs`)
- Polls the `jobs` table with `FOR UPDATE SKIP LOCKED` and handles:
  - `engagement_spike`: +25 hype for that member's cards;
  - `moderate`: computes auto-flags;
  - `publish_set`: re-validates the set and makes it live.
- Each job runs inside a savepoint, so a failing job rolls back its effects and is recorded as `failed`.
- **Simulated engagement:** every `ENGAGEMENT_SIM_INTERVAL_SECONDS` (30 s), each member gets +1 hype (see §6.2).
- **Auto-moderation flags:** profanity word list, invalid kind, and for fan art, image bytes checked against the declared type and size.
- **Tests:** 5 pass, 1 skipped (the database test needs `TEST_DATABASE_URL`).

### 4.4 Fan client: `apps/client` (Next.js 16, React 19, port 3000)
- A single-page app (`app/page.tsx`, `app/trades.tsx`) branded **"FΛZE VAULT"**, dark with a red accent.
- **Tabs:** Store, Collection, Trades, Leaderboard, Buy coins. Plus login and signup, the balance in the header, and a "DEMO EXPERIENCE" label.
- **Store:** packs with published odds (in an expandable section) and an open-pack button. The button is disabled when you can't afford the pack and keeps the idempotency key so "Retry opening" is safe. The reveal animation shows rarity and serials.
- **Collection:** rarity filter, cards grouped by set, owned count, serials and locked markers. Clicking a card opens a detail modal with hype and supply.
- **Trades:**
  - search collectors, pick cards on both sides, add an optional moderated message;
  - incoming and outgoing lists with accept, decline and cancel.
- **Leaderboard:** top collectors and trending cards (labelled simulated).
- **Buy coins:** Phantom flow in `lib/phantom.ts`:
  1. Connect the wallet.
  2. Call checkout.
  3. Build a `SystemProgram.transfer` with the reference key as a read-only account.
  4. `signAndSendTransaction`.
  5. Poll confirm.

  There's also a purchases list with a "Check payment" button for pending purchases.
- **Branch `agent-c/demo-fixes`** (pushed, **not merged yet**):
  - `next.config.mjs`: `allowedDevOrigins` for 10/8, 172/8, 192.168/16, 100/8 (Tailscale) and `*.local`, plus extra hosts from `NEXT_ALLOWED_DEV_ORIGINS`. Without this, pages opened from a phone or LAN address render but never become interactive.
  - `lib/api.ts`: `forThisHost()` swaps `localhost` in API, payments and art URLs for the page's own host when the page is opened from another device.
  - `app/page.tsx`: removed `Object.groupBy`, which crashed the Collection tab on iOS Safari before 17.4.
  - `app/trades.tsx`: offers show the cards they give and want (e.g. "They give: Rain / Creators 3 #1 (epic)") instead of just counts.
  - `lib/phantom.ts`: `NEXT_PUBLIC_SOLANA_RPC_URL` overrides the rate-limited public devnet RPC.
- An older, superseded version of the client also exists on branch `agent-c/client` (`src/app/...` layout). Don't merge it; `main`'s client replaced it.

### 4.5 Admin app: `apps/admin` (Next.js, port 3001)
- A staff console (`app/page.tsx`): sets, cards (with art upload), packs and odds, publishing, the moderation queue and engagement spikes. It hasn't been reviewed in depth in this handoff; only that it loads (HTTP 200) was verified.

### 4.6 Shared and tooling
- `packages/shared`: zod schemas and TypeScript types for the whole contract (v1.4), including the Solana types `Bundle`, `Purchase`, `CheckoutResponse`, `ConfirmBody`, `ConfirmResponse`, and `RARITY_SCORE`, `ERROR_STATUS`, `SessionClaims`.
- `tools/dev.mjs` (`npm run dev`): starts the API, payments, worker, client and admin together, and stops all of them if one crashes.
- `tests/integration`: a full demo-flow test against real API and payments processes (`npm run test:integration`, needs `TEST_DATABASE_URL`). **Not run in this session.**
- CI (`.github/workflows/ci.yml`): Postgres service plus typecheck, unit and integration tests on `main` and `agent-*/**` branches.

## 5. Running it

```bash
npm install
cp .env.example .env    # then fill the values below
# test database (only needed for tests):
sudo systemctl start docker && docker compose up -d db
npm run seed -w @faze/api       # migrates + seeds demo data (idempotent)
npm run dev                     # api :4000, payments :4100, client :3000, admin :3001, worker
```

**Values you must set in `.env`** (everything else has working defaults):

| Var | What |
|---|---|
| `DATABASE_URL` | Tiger Cloud: use the "service URL" it gives you. It must end in `?sslmode=require` (or `verify-full`, which also silences the pg SSL warning). Don't also put `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGSSLMODE` in `.env`: node-pg reads them as defaults, and `PGSSLMODE` breaks the local test database. |
| `TEST_DATABASE_URL` | Must be a **different** database. Local Docker: `postgres://faze:faze@localhost:5432/faze`. |
| `JWT_SECRET`, `INTERNAL_SECRET` | Two different values from `openssl rand -hex 32`. Shared by the API and payments. |
| `SOLANA_TREASURY_PUBKEY` | The **public** address of a devnet wallet that receives payments. It must be a different wallet from the one that buys; paying yourself fails the received-amount check. |

**For the Phantom purchase:** Phantom → Settings → Developer Settings → Testnet Mode → Solana Devnet. Fund the buyer wallet at https://faucet.solana.com.

**Phone demo:** open `http://<laptop-LAN-IP>:3000` (requires the `agent-c/demo-fixes` branch) and add that origin to `CLIENT_ORIGINS`. Payments still accepts only one `CLIENT_URL`; see §6.5.

**Verified in this session** (Tiger Cloud DB, real browser via Chromium):
- Typecheck passes in all workspaces.
- Migrate and seed worked.
- Login, store, pack open (balance 500 → 400 → 300), reveal, collection, trades, leaderboard and the buy-coins page all work.
- At 375 px wide there's no horizontal overflow.
- **Not verified:** a real Phantom purchase, an accepted trade through the UI, the admin flows, the API and integration test suites (Docker wasn't running).

## 6. Issues that can break the demo or the idea

Ordered by impact. "Verified" means it was observed on the running stack against the live database.

### 6.1 Card art is not stored in the database (verified) — owner: A (@toosh-legacy). **Fix approved as v1.5, in progress**
- **Demo art:** the 40 seed SVGs are files in `content/seed/art/`, served from disk by `GET /demo-art/:file` (`services/api/src/app.ts`).
- **Uploaded art:** `POST /admin/art` writes to `UPLOAD_DIR`, default `.data/uploads/` on local disk (`services/api/src/routes/art.ts`).
- **What breaks:**
  - **Card images disappear when the API runs anywhere else**, or on a host with temporary disk (most PaaS hosts), even though the card rows survive in Tiger.
  - **`art_url` stores an absolute `http://localhost:4000/...`.** All 40 rows in the live database have this. Images break on any other device or deployment. Changing `API_URL` later doesn't fix existing rows, so it needs a re-seed or an UPDATE.
- **Proposed fix:**
  1. Migration `002`: `card_art(id uuid pk, mime text, bytes bytea, created_at)`.
  2. `/admin/art` inserts into it.
  3. `GET /art/:id` serves from the database with cache headers.
  4. The seed imports the 40 SVGs into it.
  5. Store **relative** `/art/<id>` URLs. The client already resolves relative URLs against the API.

  This requires the lead to reverse contract v1.4 ("artUrl always absolute").
- **Workaround on the demo-fixes branch:** the client swaps `localhost` image URLs for the page host. This makes LAN demos work, but it isn't a fix for deployment.

### 6.2 Hype saturates, so the "hype climbs" demo step breaks (verified) — owner: D (@tanejakeshav)
- The worker's `tick()` adds +1 hype to **every** card every 30 s, capped at 100 (`services/worker/src/jobs.mjs`, `engagement()`).
- At review time all 40 cards were at exactly 18, and identical.
- After about 50 minutes of uptime every card is at 100: the admin spike (+25) changes nothing, and Trending is a 40-way tie.
- **Fix:** random walk or decay toward a baseline, per-member variation, or only simulate a few random members per tick.
- **Demo workaround:** restart the stack shortly before the demo and reset hype first, e.g. `UPDATE card_stats SET hype = <catalog value>`.

### 6.3 Worker hammers the moderation queue every second (verified) — owner: D
- `tick()` calls `moderatePending()` every 1 s. It runs `SELECT *` and an `UPDATE` on **every** pending submission.
- Observed: one row updated 368 times in about 10 minutes.
- Fan-art payloads are up to 2 MB of base64 each and get re-read every second from the remote database. That costs latency and egress on Tiger and loads the shared connection pool.
- **Fix:** only process rows whose flags haven't been computed, or rely solely on the `moderate` jobs.

### 6.4 Only works on the host machine without the demo fixes — owner: C (fixed on branch, needs merge)
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_PAYMENTS_URL` default to `localhost`.
- Next 16's dev server blocks non-localhost origins, so pages render but never hydrate.
- **Merge `agent-c/demo-fixes`.**

### 6.5 Payments CORS allows only one origin — **FIXED on main (f6b0202)**: payments now reads `CLIENT_ORIGINS` (comma list)
- `services/payments/src/app.ts` passes the single `CLIENT_URL` to CORS. The API accepts a list (`CLIENT_ORIGINS`).
- With a phone and a laptop in the demo, one of them can't buy coins.
- **Fix:** accept a comma-separated list, like the API.

### 6.6 The public Solana devnet RPC is rate-limited
- Both the browser (`lib/phantom.ts`, `getLatestBlockhash`) and the payments service (`getParsedTransaction`, `getSignaturesForAddress`, plus the reconcile loop every 15 s) use `https://api.devnet.solana.com`.
- 429 errors mid-demo leave purchases stuck on "retry shortly".
- **Fix:** a free dedicated devnet endpoint (Helius, QuickNode, Alchemy and others) in `SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL`. The lead needs to add the latter to `.env.example`.
- Also, devnet itself is occasionally slow or degraded. Keep `PAYMENTS_SIMULATE=1` as a fallback for a recorded demo, and say so honestly.

### 6.7 New users can't be found for trading until an admin approves them
- Display names start as `pending`. Other users see them as "New collector", and they're excluded from `GET /users?q=`.
- The worker only flags names; nothing approves them automatically.
- In the demo, use the seeded `fan1`/`fan2`, which are pre-approved, or approve the new user in the admin app first. Approving a flagged name is demo step 7 anyway.

### 6.8 Phantom gotchas
- If Phantom isn't in **Devnet** mode, the transaction is built with a devnet blockhash, fails, and shows a generic error. Check the network before demoing.
- The treasury and buyer must be different wallets.
- The buyer needs devnet SOL for the payment plus the fee.

### 6.9 Tests can't run locally right now
- The Docker daemon is inactive, and user `jaideep` isn't in the `docker` group.
- Run `sudo systemctl start docker`, and optionally `sudo usermod -aG docker $USER` then log out and back in.
- After that, `docker compose up -d db` provides `TEST_DATABASE_URL`.

### 6.10 Smaller things
- **Servers listen on `0.0.0.0`**, so the API and payments are reachable by anyone on the LAN or Tailscale. Fine for a demo; don't leave it running on public Wi-Fi.
- **`GET /users/:id/collection` needs no login.** Anyone with a user ID can view that collection. Probably acceptable, since collections are meant to be showable, but it's a decision.
- **Pack opening locks every card row in the set**, so opens of the same set are serialized. That's fine at hackathon scale.
- **Repo path:** the project lives under `~/Projects/__pycache__/`. Some tools and cleanup scripts delete or ignore `__pycache__` directories, so moving it is safer.
- **Local leftovers:**
  - `/tmp/claude-1000/env.backup` may contain the database password; delete it.
  - The treasury keypair JSON is in `~/Downloads/wallet-1-keypair.json`. It's a private key, even if only for devnet; move it somewhere private.
- **Untracked files:** `apps/client/AGENTS.md` and `apps/admin/AGENTS.md` were generated by Next.js. Decide whether to commit them or add them to `.gitignore`.

## 7. Things worth adding next

### 7.1 Finish the demo first (master.md §2, milestone H+20)
1. Merge `agent-c/demo-fixes` and fix §6.1 to §6.5.
2. Run `npm run test:integration` green on `main` (the full demo flow).
3. Do a full dry run with a real Phantom purchase and a two-window trade (fan1 ↔ fan2).
4. Rehearse the ~3-minute demo script in `README.md`. Pre-fund the buyer wallet, and reset hype just before.

### 7.2 Client polish (C)
- Visual card detail on offers: render card thumbnails in the trade inbox, not just names.
- Live updates: poll `/me/trades` and `/me` every few seconds, or add SSE, so the recipient sees the offer and both collections update without pressing Refresh. The README demo script says "both collections update live".
- Pull reveal: one card at a time with a rarity-coloured flash; save the pull as a shareable image.
- An empty-state onboarding flow ("open your first pack").
- Loading skeletons and a better error copy per error code (`INSUFFICIENT_COINS` → "Buy coins" CTA).
- Accessibility pass: focus management in the modal, labelled form controls, colour contrast on the rarity badges.

### 7.3 Stretch goals from master.md §7 (only after the demo works end to end)
- **Card crafting:** burn 5 duplicates for 1 card of the next rarity. Server-side, in one transaction, logged.
- **Daily login reward** through the ledger (`reason` would need a new enum value: contract change).
- **Push notifications** for trade offers and accepts.
- **Live auction house.**
- **Shareable card images** for social (server-rendered PNG with the serial and owner).

### 7.4 Ideas that fit the Solana direction (all need lead approval)
- **Show the transaction:** link each paid purchase to Solana Explorer (`https://explorer.solana.com/tx/<sig>?cluster=devnet`) in the purchases list. Cheap to build, and it shows the on-chain verification well.
- **Solana Pay QR code:** checkout already returns `solanaPayUrl`, so rendering it as a QR code lets judges pay from Phantom on their phone.
- **Optional on-chain proof of ownership:** mint legendary pulls as compressed NFTs on devnet. This is a big scope increase; only consider it after the demo is solid, and keep the database authoritative.

### 7.5 Ops and hardening
- Images in the database (§6.1) and relative URLs, so the app can be deployed.
- A dedicated devnet RPC (§6.6).
- Rate limiting on auth and pack open.
- Expire stale `pending` purchases (the status `expired` exists, but nothing sets it).
- A hosting plan for API, payments and worker plus Tiger Cloud, if the lead adopts Tiger.

## 8. Open questions for the lead (@Abhijith-utla)
1. Adopt Tiger Cloud as the shared database? (It's open in `agents/lead.md`.)
2. ~~Card art in Postgres + relative `artUrl`~~ APPROVED as contract v1.5; @toosh-legacy is implementing it.
3. ~~Payments CORS list, `NEXT_PUBLIC_SOLANA_RPC_URL` in `.env.example`~~ DONE on main (f6b0202).
4. ~~Merge `agent-c/demo-fixes`~~ Approved by the lead and merged to main.

Still open with @tanejakeshav (flagged demo-blocking by the lead): hype saturation (§6.2), the 1 s moderation re-scan (§6.3), and making the admin app resolve relative `artUrl`.

All of the §6 items were posted to the board on 2026-11-15, addressed to each owner: comment #6891407199 on issue #1.
