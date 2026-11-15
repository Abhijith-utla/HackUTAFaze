# Agent B — Payments & integration QA — @Abhijith-utla

Owns: `services/payments/`, `tests/integration/`.
Consumes: A's internal ledger credit endpoint, the contract.

## Features
1. **Coin bundles** — `GET /payments/bundles` (e.g. 1,000 coins $4.99 — test mode only).
2. **Stripe Checkout** — `POST /payments/checkout` creates a Checkout Session for the logged-in user, returns the redirect URL.
3. **Webhook** — `POST /payments/webhook` verifies the Stripe signature, then credits coins through A's `/internal/ledger/credit` with the Stripe event id as the idempotency key. The client never reports a payment result.
4. **Purchase history** — `GET /me/purchases`; every row tagged `test_mode: true`.
5. **Integration tests** (`tests/integration/`) — one script that runs the full demo flow (master.md §2) against a running stack: signup → open pack → checkout (Stripe CLI `trigger` or mocked signed event) → trade between two users → leaderboard. Runs in CI.
6. **Abuse checks** — replayed webhook does not double-credit; opening a pack with insufficient coins fails; accepting a trade twice fails; a fan cannot hit admin endpoints.

## Done when
- Test-card purchase credits coins exactly once, visible in the client.
- `npm run test:integration` passes on `main`.

## Coordinate
- Needs `/internal/ledger/credit` from @toosh-legacy (stub it locally until it lands).
- Needs checkout button + success/cancel pages from @Jaideepo7.
