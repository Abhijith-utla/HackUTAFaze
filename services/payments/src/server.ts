import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { httpLedger, memoryLedger } from "./ledger.js";
import { memoryRepo, pgRepo } from "./repo.js";
import { rpcReader, simulatedReader } from "./solana.js";

// services/payments/.env first, then the repo-root .env (first value wins; real env beats both).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, "..", ".env"), quiet: true } as never);
loadEnv({ path: path.join(here, "..", "..", "..", ".env"), quiet: true } as never);

const cfg = loadConfig();

// PAYMENTS_STANDALONE=1 runs without Postgres and Agent A's API (in-memory purchases + ledger).
const standalone = process.env.PAYMENTS_STANDALONE === "1";

const app = buildApp({
  repo: standalone ? memoryRepo() : pgRepo(new pg.Pool({ connectionString: cfg.databaseUrl })),
  ledger: standalone ? memoryLedger() : httpLedger(cfg.apiUrl, cfg.internalSecret),
  chain: cfg.simulate ? simulatedReader(cfg.treasury, cfg.cluster) : rpcReader(cfg.rpcUrl, cfg.cluster),
  treasury: cfg.treasury,
  jwtSecret: cfg.jwtSecret,
  clientUrl: cfg.clientUrl,
  logger: true,
});

app
  .listen({ port: cfg.port, host: "0.0.0.0" })
  .then(() =>
    app.log.info(
      `payments on :${cfg.port} — Solana ${cfg.cluster} (TEST payments)${cfg.simulate ? ", SIMULATED chain" : ""}${standalone ? ", standalone" : ""}`,
    ),
  )
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
