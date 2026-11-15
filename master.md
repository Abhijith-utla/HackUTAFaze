# master.md — FaZe Collector Cards (HackUTA 2026, FaZe track)

Single source of truth for product rules, architecture and who builds what. Agents read this and `AGENTS.md` before coding. Only the lead edits this file; propose changes on the board.

## 1. Product in one paragraph

Fans collect digital trading cards of FaZe members and moments. They earn or buy coins, open packs with published odds, build a collection, trade cards with other fans, and climb leaderboards. Card stats react to (simulated) creator engagement. FaZe staff add new card sets through an admin tool, and every user-submitted image or name passes moderation before it is shown.

## 2. Demo flow (what the judges see, in order)

1. Sign up → receive 500 starter coins (labelled demo).
2. Open the store → buy a pack with coins → animated pack opening shows 5 cards with rarities.
3. Collection page: cards grouped by set, rarity, duplicates count, serial numbers.
4. Buy more coins with **Phantom wallet on Solana devnet** (devnet SOL, no real value) → server verifies the transaction on-chain → balance updates.
5. Trade: send an offer to another demo user → they accept → both collections update.
6. Leaderboard + a card whose "hype" stat rose after a simulated engagement spike.
7. Admin: publish a new card set, approve one flagged submission, show it live in the store.

Anything not on this list is a stretch goal (§9).

## 3. Product rules (non-negotiable)

- **Server is authoritative** for pulls, odds, balances, trades and payments. The client only renders results.
- Pack odds are published per pack and pulls use a server-side CSPRNG. Every pull is logged with the odds version used.
- Balances change only through the append-only `ledger` (no direct balance writes). Balance = sum of ledger entries.
- Trades are atomic: both sides' cards are locked when an offer is made and swapped in one transaction on accept.
- Coins are not cashable. No real-money payout. Payments use Phantom + Solana **devnet only** (mainnet refused at boot); the server verifies every payment on-chain before crediting.
- Demo seeds, simulated engagement and test payments are labelled `demo` in data and in the UI.
- No secrets in code. Every env var is listed in `.env.example`.

## 4. Architecture

```
apps/client  (Next.js web, responsive mobile)  ──HTTP/JSON──▶  services/api  (Node/TS, Postgres)
apps/client/app/admin  (staff only, /admin + /admin/control) ──▶  services/api
services/payments  (Solana devnet verify)       ──internal──▶  services/api ledger
                   ◀──RPC── api.devnet.solana.com      (client signs with Phantom)
services/worker    (queues: moderation, engagement sim, set publishing)
packages/shared    (TS types + zod schemas generated from docs/api.md, docs/data-model.md)
```

- One PostgreSQL database shared by all services, via server-only `DATABASE_URL` (TLS `sslmode=require` for any remote host). Preserve SQL transactions, row locks and unique constraints. Migrations live in `services/api/migrations/` (Agent A owns them; others request schema changes on the board). Managed hosting (e.g. Tiger Cloud) is pending the lead's decision.
- Auth: email + password with JWT (httpOnly cookie). Roles: `fan`, `admin`.
- Local dev: `docker compose up -d db`; each service has `npm run dev`. Tests use a separate `TEST_DATABASE_URL`. Never expose database credentials to browser apps.

## 5. Contract

- `docs/api.md` — every endpoint, request/response shape, error codes.
- `docs/data-model.md` — tables, columns, invariants.
- `packages/shared` — types mirroring both docs.

Frozen once the build starts. Only the lead changes them; changes are announced on the board with `@all`.

## 6. Feature split

Detailed task lists are in `agents/`:

| Agent | Brief |
|---|---|
| Lead | `agents/lead.md` |
| A — Core API & game economy | `agents/A-core-api.md` |
| B — Payments & integration QA | `agents/B-payments-qa.md` |
| C — Fan client (web + mobile) | `agents/C-client.md` |
| D — Content pipeline & moderation | `agents/D-content.md` |

## 7. Stretch goals (only after the demo flow works end to end)

Card crafting (burn 5 duplicates → 1 higher rarity), daily login reward, push notifications, live auction house, shareable card images for social.

## 8. Ownership

| Area | Owner (GitHub) | Folders |
|---|---|---|
| Lead: contract, docs, merges | @Abhijith-utla | `master.md`, `README.md`, `AGENTS.md`, `docs/`, `agents/`, `packages/shared/`, root config, `tools/`, `.claude/`, `.github/` |
| A — Core API & game economy | @toosh-legacy | `services/api/` |
| B — Payments & integration QA | @Abhijith-utla | `services/payments/`, `tests/integration/` |
| C — Fan client (web + mobile) | @Jaideepo7 | `apps/client/` |
| D — Content pipeline & moderation | @tanejakeshav | `services/worker/`, `apps/client/app/admin/` (staff console), `content/seed/` |

## 9. Milestones (hackathon clock)

| By | Done means |
|---|---|
| H+2 | Contract frozen, repo skeleton runs, board live, every agent posted once |
| H+8 | Signup, wallet, pack open working via API; client renders a pull from the real API |
| H+14 | Server-verified Solana devnet payment credits coins; trades work; admin can publish a set |
| H+20 | Full demo flow (§2) passes the integration test on `main` |
| H+22 | Feature freeze. Bug fixes, demo seed, pitch recording only |
