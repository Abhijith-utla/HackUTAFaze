# Full demo integration

Set TEST_DATABASE_URL to an isolated Tiger Cloud test database, keep DATABASE_URL pointed at a distinct development database, then run npm run test:integration. There is no application database fallback or unverified external-stack reuse. API/payments start as real processes on ports 4400/4500. API uses its dedicated test database selection; payments receives the same test URL privately. Requires the API test-database configuration from Agent A.

The runner seeds demo data and tests the HTTP flow using explicitly simulated Solana transactions, not real currency. Required endpoints and a live seeded pack must exist; missing implementations fail setup. STACK_LOGS=1 prints service stdout. tests/integration/demo.ts also provides a direct injected demo smoke script.

Use disposable test data: fixtures may remain after a run. Never use production. Native PostgreSQL can be used for local protocol-compatible checks; live Tiger Cloud TLS/connectivity and actual Phantom/devnet payments require a separate manual smoke test and are not established by simulation or unit tests.
