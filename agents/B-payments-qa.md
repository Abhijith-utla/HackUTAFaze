# Agent B — Payments & integration QA — @Abhijith-utla

Owns: `services/payments/`, `tests/integration/`.
Consumes: A's internal ledger credit endpoint, the contract.

## Features
1. **Coin bundles** — `GET /payments/bundles` priced in devnet SOL (1,000 coins = 0.05 SOL). Devnet only.
2. **Checkout** — `POST /payments/checkout` creates a pending purchase with a fresh Solana Pay `reference` pubkey; returns recipient, lamports, reference, Solana Pay URL.
3. **Confirm** — `POST /payments/confirm` reads the transaction from the devnet RPC (or finds it by reference), checks success + reference + treasury received ≥ lamports + signature unused, then credits through A's `/internal/ledger/credit` with key `purchase:<id>`. The client never reports a payment result.
4. **Purchase history** — `GET /me/purchases`; every row tagged `test_mode: true`, `cluster: devnet`.
5. **Integration tests** (`tests/integration/`) — one script that runs the full demo flow (master.md §2) against a running stack: signup → open pack → checkout + confirm (with `PAYMENTS_SIMULATE=1`) → trade between two users → leaderboard. Runs in CI.
6. **Abuse checks** — repeated confirm / reused signature does not double-credit; opening a pack with insufficient coins fails; accepting a trade twice fails; a fan cannot hit admin endpoints.
7. **Phantom helper** for the client — `docs/phantom-checkout.md`.

## Done when
- A Phantom devnet payment credits coins exactly once, visible in the client.
- `npm run test:integration` passes on `main`.

## Coordinate
- Needs `/internal/ledger/credit` from @toosh-legacy (stub it locally until it lands).
- Needs the Phantom connect + pay button from @Jaideepo7 (helper in `docs/phantom-checkout.md`).
