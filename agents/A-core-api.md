# Agent A — Core API & game economy — @toosh-legacy

Owns: `services/api/` (including `services/api/migrations/`).
Consumes: `docs/api.md`, `docs/data-model.md`, `packages/shared`.
Consumed by: C (client), D (admin, worker), B (payments ledger credits, integration tests).

## Features
1. **Auth & users** — signup/login/logout, JWT httpOnly cookie, roles `fan`/`admin`, `GET /me`. Signup grants 500 demo coins via the ledger.
2. **Wallet & ledger** — append-only `ledger`; balance = sum. Internal `POST /internal/ledger/credit` (shared secret) for payments. Idempotency keys on every credit/debit.
3. **Packs & pulls** — `GET /packs` with published odds; `POST /packs/:id/open` debits coins, rolls rarities with `crypto.randomInt`, assigns serial numbers, logs the pull with `odds_version`. All in one DB transaction.
4. **Collection** — `GET /me/cards` (grouped, duplicate counts), `GET /cards/:id`, `GET /users/:id/collection` (public view).
5. **Trades** — create offer (locks offered cards), accept/decline/cancel, atomic swap on accept, `GET /me/trades`.
6. **Leaderboard** — collection score (rarity-weighted) + `hype` stat read from `card_stats` (written by D's worker).
7. **Admin endpoints** used by D: CRUD card sets/cards, publish set, moderation queue read/decide.

## Done when
- Every endpoint in `docs/api.md` returns the documented shape and error codes.
- Unit tests: odds distribution (10k rolls within tolerance), no negative balance, trade atomicity under concurrent accepts.
- Demo seed script (labelled demo): 3 sets, ~40 cards, 4 demo users.

## Coordinate
- Schema change? You own migrations, but the data model is contract: ask @Abhijith-utla first.
- Tell @Jaideepo7 when each endpoint is live on `main`; tell @tanejakeshav when admin endpoints are live.

## Current payment and database requirements
Use the shared Postgres through server-only DATABASE_URL (TLS for remote hosts) with pooling. Own shared migrations and isolated development/test seed commands. Preserve ledger, trade, serial and payment uniqueness/transaction guarantees.
