# Full demo integration test

Set TEST_DATABASE_URL to an isolated Tiger Cloud test database and run `npm run test:integration` from the repo root. The script applies migrations and writes uniquely labelled test fixtures. Use a disposable test database; it does not delete unrelated data. Never point it at production.

It starts a real local API listener, injects payment HTTP requests using PostgreSQL purchase persistence, and credits through the real internal ledger HTTP boundary. Solana RPC is explicitly simulated; no real currency is transferred. It covers signup bonus, packs, publishing, payment confirmation/replay, moderation, trade acceptance/replay, collection ownership and leaderboard.

Live Tiger Cloud and real Phantom/devnet verification remains a separate manual smoke test described in services/payments/README.md. The script fails clearly if TEST_DATABASE_URL is absent rather than silently using a default database.
