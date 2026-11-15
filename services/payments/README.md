# services/payments — Agent B (@Abhijith-utla)

Coin purchases with **Phantom wallet + Solana devnet** (devnet SOL has no value: test payments, demo only). The server credits coins only after reading the transaction from the RPC and checking it (Solana Pay reference pattern), via Agent A's `POST /internal/ledger/credit` (idempotency key `purchase:<purchaseId>`).

```
npm run dev -w @faze/payments                          # :4100; needs DATABASE_URL, JWT_SECRET, INTERNAL_SECRET, SOLANA_TREASURY_PUBKEY
PAYMENTS_STANDALONE=1 npm run dev -w @faze/payments    # no Postgres / API: in-memory purchases + ledger
PAYMENTS_SIMULATE=1 ...                                # test-only simulated chain (integration tests, offline)
npm test -w @faze/payments
```

Demo setup:
1. In Phantom: Settings → Developer settings → Testnet mode → **Solana Devnet**.
2. Create a separate treasury wallet; copy its **public** address into `SOLANA_TREASURY_PUBKEY`. No private key goes anywhere.
3. Fund the buyer wallet with devnet SOL: `solana airdrop 2 <address> --url devnet` or https://faucet.solana.com.

Checks on confirm: tx exists at `confirmed`, no error, contains this purchase's `reference`, treasury balance rose by ≥ `lamports`, signature not used by another purchase. Mainnet cluster/RPC URLs are refused at boot.

## Durable fulfillment and Tiger Cloud

Use the Tiger Cloud service's private PostgreSQL connection URL in DATABASE_URL, including its TLS settings (sslmode=require or stricter). The PostgreSQL driver and pooled connections support Tiger Cloud; never place credentials in client configuration. No real Tiger Cloud service or wallet credentials are included in this repository.

After chain verification, the service atomically reserves the unique tx_signature on the pending purchase before crediting the ledger. A pending row with a signature is a verified, retryable fulfillment. Concurrent reservations cannot use the same signature for another purchase. Ledger credits retain purchase:<purchaseId> idempotency keys. Marking paid happens after credit succeeds; a restart between those steps safely retries the same credit.

The server reconciles pending purchases every 15 seconds, discovering transfers by reference and completing reserved credits even after the browser closes or RPC becomes unavailable. Single-service scans do not overlap; multiple instances remain safe through signature uniqueness and ledger idempotency. The test-only standalone repository is not durable and must not be used for actual fulfillment.

Run `npm run typecheck --workspace @faze/payments` and `npm test --workspace @faze/payments`. The suite includes concurrent signature reuse and reconciliation regression coverage.

Manual devnet smoke test: configure a real devnet RPC, treasury public key and Tiger Cloud service; leave PAYMENTS_SIMULATE unset and PAYMENTS_STANDALONE=0. Start API/payments and the client. Sign in, connect a funded devnet Phantom wallet, buy a bundle, verify purchase history/balance, and retry confirmation to verify no additional coins. Repeat with browser closed after submission and check reconciliation. This manual chain/Tiger Cloud check requires external credentials and was not performed by the implementation agent.
