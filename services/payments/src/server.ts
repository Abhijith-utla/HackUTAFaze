import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { httpLedger, memoryLedger } from "./ledger.js";
import { memoryRepo, pgRepo } from "./repo.js";
import { makeGateway } from "./stripe.js";

const cfg = loadConfig();

// PAYMENTS_STANDALONE=1 runs without Postgres and Agent A's API (in-memory purchases + ledger).
const standalone = process.env.PAYMENTS_STANDALONE === "1";

const app = buildApp({
  repo: standalone ? memoryRepo() : pgRepo(new pg.Pool({ connectionString: cfg.databaseUrl })),
  ledger: standalone ? memoryLedger() : httpLedger(cfg.apiUrl, cfg.internalSecret),
  gateway: makeGateway(cfg),
  jwtSecret: cfg.jwtSecret,
  clientUrl: cfg.clientUrl,
  logger: true,
});

app
  .listen({ port: cfg.port, host: "0.0.0.0" })
  .then(() => app.log.info(`payments on :${cfg.port} (stripe=${cfg.stripeMode}${standalone ? ", standalone" : ""}, TEST MODE)`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
