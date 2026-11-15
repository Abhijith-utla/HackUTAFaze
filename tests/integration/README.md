# tests/integration — Agent B (@Abhijith-utla)

Full demo flow (master.md §2) against real `services/api` + `services/payments` processes and Postgres.

```
docker compose up -d db
npm run test:integration            # starts api on :4400 and payments on :4500 (PAYMENTS_SIMULATE=1), seeds, runs
API_URL=... PAYMENTS_URL=... npm run test:integration   # or point at an already-running stack
STACK_LOGS=1 npm run test:integration                   # show service stdout
```

Steps for endpoints that are not live are reported as skipped, never faked. Payments use the test-only simulated chain (signature `sim_<reference>_<lamports>`); real devnet verification is covered by `services/payments` unit tests + a manual Phantom run.
