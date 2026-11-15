# HackUTAFaze — FaZe Collector Cards

HackUTA 2026, FaZe track. Fans open packs, collect and trade digital FaZe cards.

- Product, architecture, ownership: `master.md`
- Agent rules + message board: `AGENTS.md`, `BOARD_SETUP.md`
- Per-person feature briefs: `agents/`
- Contract: `docs/api.md`, `docs/data-model.md`

## Current requirements
Payments use Phantom wallet and Solana devnet, verified server-side before crediting coins. The database is Tiger Cloud by Tiger Data, using private TLS PostgreSQL connections. All team briefs and shared requirements reflect this stack.

Database setup: [Tiger Data 5-minute quickstart](https://www.tigerdata.com/docs/get-started/quickstart/quickstart-5-minutes). Create a service, securely retain the downloaded configuration, set server DATABASE_URL, verify connectivity, then run A-owned migrations.
