# Direct SOL pack checkout

The fan Store buys packs directly with Phantom on Solana devnet. There is no Buy Coins tab or coin balance in the fan UI. Legacy ledger/coin endpoints remain available for backward compatibility; direct pack purchases neither credit nor debit that ledger.

- GET /packs includes priceLamports, calculated server-side from existing pack pricing units and PACK_LAMPORTS_PER_COIN (default 50000: a pack with 100 legacy units costs 0.005 devnet SOL).
- POST /packs/:id/checkout requires a session and {payerWallet,idempotencyKey: UUID}. Returns purchaseId, packId, recipient, reference, lamports, cluster, simulated, status. Same key/user/request returns the same immutable quote; reusing a key for another request fails. Packs must have an unlimited common-card fallback before payment is offered.
- POST /pack-purchases/:id/confirm accepts {signature?}. If omitted, discovers a transaction by reference. Verifies the RPC devnet genesis hash, finalized successful transaction, reference, signed payer and exact native SOL System Program transfer to the stored treasury. Only then persists the globally unique signature and fulfills the order.
- Fulfillment uses the server-side CSPRNG and serial allocation shared with existing pulls. The stored quote snapshots pack price/configuration. Cards, pull log and fulfilled purchase marker commit atomically. Parallel/replayed confirmations return the same pull. Verified-but-unfulfilled purchases retain their signature and can retry without relying on RPC availability. If staff changes all eligible inventory after checkout, staff must restore inventory before that purchase can finish; do not request a second payment.
- GET /me/pack-purchases returns the latest 50 owned pack purchases, including cards for delivered orders. The Store provides Check payment for pending orders. Closing a tab does not lose the receipt; reopening Store and checking completes it. This new flow does not currently run a separate background pack-order reconciliation job.

Migration 005 adds pack_snapshot and pack_pull_id to purchases. Existing purchases.tx_signature uniqueness prevents reuse between coin and pack purchases. Pack orders have bundle_id pack:<packId> and coins=0; the legacy coin-confirmation service rejects them and its reconciler excludes them.

The browser retains only a user-scoped checkout hint and signature in localStorage. It re-fetches the authenticated server quote before sending. After an uncertain wallet response it only retries confirmation; it does not automatically send a second transfer. A wallet rejection permits retry of the same checkout. Wallet signing keys remain in Phantom.

Set SOLANA_CLUSTER=devnet, SOLANA_RPC_URL to a devnet RPC, SOLANA_TREASURY_PUBKEY to the receiving public address, and PAYMENTS_SIMULATE=0 for wallet use. A simulated checkout is refused by the wallet UI before transmitting funds. Simulated verification remains available to local automated tests and is refused in production. The displayed pack price excludes network fees.

Run npm run migrate --workspace @faze/api and restart services after updating. Existing demo coins and older purchases remain stored; no balance migration is performed. Live wallet verification requires a funded devnet wallet and is not claimed by automated tests.

RPC references: https://solana.com/docs/rpc/http/gettransaction and https://solana.com/docs/rpc/json-structures.
