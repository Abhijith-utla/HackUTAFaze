# Security and live verification status

Do not commit real environment files, database configuration downloads, wallet seed phrases, private keys, or access tokens. `.gitignore` excludes local environments, `.data` database/uploads/test tooling, dependencies, builds and logs. Keep `.env.example`, migrations, package-lock.json, and original demo seed art tracked.

Demo seed accounts and local CI database credentials are intentionally public test fixtures. Never use these accounts or credentials for real data. Tiger Cloud URLs and JWT/internal secrets must be configured privately. Payment receiving configuration uses a public treasury address; Phantom retains signing keys in the wallet.

The implementation uses Solana devnet and server-verified payment credits. Automated tests use isolated PostgreSQL plus explicitly simulated chain responses. Live Tiger Cloud TLS connectivity and real Phantom devnet payment smoke testing require private configuration and a funded devnet wallet and have not been performed.

Dependency audit: test runners upgraded to Vitest 4.1.12+ and payments upgraded to Fastify 5 with matching plugins. The final audited lockfile still reports six findings (three high, three moderate), involving Zod 3 and Solana SDK 1 / bigint-buffer / jayson / stream-json / uuid. These are package advisories, not evidence of exposed credentials. Resolving them requires a separately validated Zod 4 and Solana SDK major-version migration; this demo should not be treated as production hardened. Do not run automated force upgrades without adapting shared validation and transaction construction.

Staff uploads are limited to PNG/JPEG/WebP with size, base64 and signature checks. These checks do not replace full image decoding/re-encoding for production. Runtime artwork storage needs a persistent mounted directory or object storage before deployment; local build output is not durable storage.
