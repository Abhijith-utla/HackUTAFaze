# HackUTAFaze — FaZe Collector Cards

HackUTA 2026, FaZe track. Fans open packs of digital FaZe cards, build a collection, trade with other fans, climb the leaderboard, and buy coins with **Phantom wallet on Solana devnet** (test payments, no real value).

| Doc | What |
|---|---|
| `master.md` | Product, demo flow, rules, architecture, ownership, milestones |
| `AGENTS.md` | Agent rules, message board, git workflow |
| `agents/` | Per-person feature briefs |
| `docs/api.md`, `docs/data-model.md` | Frozen contract (v1.2) |
| `docs/phantom-checkout.md` | Client Phantom/Solana payment flow |

## Team

| Area | Owner |
|---|---|
| Lead + payments & integration QA | @Abhijith-utla |
| Core API & game economy | @toosh-legacy |
| Fan client (web + mobile) | @Jaideepo7 |
| Content pipeline & moderation | @tanejakeshav |

## Run it

```bash
npm install
docker compose up -d db                 # local Postgres (or point DATABASE_URL at managed Postgres with sslmode=require)
cp .env.example .env                    # fill JWT_SECRET, INTERNAL_SECRET, SOLANA_TREASURY_PUBKEY
npm run seed -w @faze/api               # demo data (labelled demo), idempotent
npm run dev                             # api :4000, payments :4100, client :3000, admin :3001, worker
```

Demo accounts (seeded, demo only): `fan1@demo.faze` … `fan4@demo.faze` / `demo-fan-pass`, `admin@demo.faze` / `demo-admin-pass`.

Payments without a wallet: set `PAYMENTS_SIMULATE=1` (test-only; signatures `sim_<reference>_<lamports>`). With a wallet: Phantom → Settings → Developer settings → Testnet mode → Solana Devnet, fund at https://faucet.solana.com, and put a separate treasury wallet's **public** address in `SOLANA_TREASURY_PUBKEY`.

## Test

```bash
npm run typecheck
npm test                    # unit tests in every workspace (api tests need the db)
npm run test:integration    # full demo flow against real api + payments processes
```

CI (`.github/workflows/ci.yml`) runs all three on `main` and every `agent-*/**` branch.

## Demo script (≈3 min, master.md §2)

1. Sign up a new fan → 500 starter coins (demo label in the header).
2. Store → open a pack → reveal animation with rarities.
3. Collection → sets, rarity, duplicates, serial numbers → open a card's detail (hype stat).
4. Buy coins → Phantom pops up on devnet → approve → "Confirming on Solana devnet…" → balance jumps. Mention: server verifies the transaction on-chain; client never reports a payment.
5. Log in as `fan2` in a second window → trade offer from fan1 → accept → both collections update live.
6. Leaderboard → admin triggers an engagement spike → a card's hype climbs in "Trending" (simulated, labelled).
7. Admin → publish a new set → it appears in the store; approve a flagged display name.

## Rules that matter

Server-authoritative pulls, odds, balances, trades and payments. Append-only ledger. Devnet only (mainnet refused at boot). Every seed, simulated engagement event and test payment is labelled. No secrets in code.

Database: PostgreSQL via server-only `DATABASE_URL` (local default: `docker compose up -d db`). Managed Postgres such as Tiger Cloud works through the same URL with `sslmode=require`; adopting it is **pending the lead's decision**. Set a distinct `TEST_DATABASE_URL` before running tests. Live managed-DB and real Phantom devnet checks are manual.

Public trading: visit http://localhost:3000/trades. After pulling this feature, run npm run migrate --workspace @faze/api, then restart services. See docs/marketplace.md for the exchange and notification contract.
