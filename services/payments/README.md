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
