import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { httpLedger, memoryLedger } from "./ledger.js";
import { memoryRepo, pgRepo } from "./repo.js";
import { rpcReader, simulatedReader } from "./solana.js";
import { reconcile } from "./fulfill.js";

// services/payments/.env first, then the repo-root .env (first value wins; real env beats both).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, "..", ".env"), quiet: true } as never);
loadEnv({ path: path.join(here, "..", "..", "..", ".env"), quiet: true } as never);

const cfg = loadConfig();

// PAYMENTS_STANDALONE=1 runs without Postgres and Agent A's API (in-memory purchases + ledger).
const standalone = process.env.PAYMENTS_STANDALONE === "1";

const deps = {
  repo: standalone ? memoryRepo() : pgRepo(new pg.Pool({ connectionString: cfg.databaseUrl })),
  ledger: standalone ? memoryLedger() : httpLedger(cfg.apiUrl, cfg.internalSecret),
  chain: cfg.simulate ? simulatedReader(cfg.treasury, cfg.cluster) : rpcReader(cfg.rpcUrl, cfg.cluster),
  treasury: cfg.treasury,
  jwtSecret: cfg.jwtSecret,
  clientUrl: cfg.clientUrl,
  logger: true,
};
const app = buildApp(deps);

// Catch up purchases paid on-chain whose buyer never confirmed: last 30 min, 10 per 30 s tick.
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const n = await reconcile(deps.repo, deps.ledger, deps.chain, { maxAgeMs: 30 * 60_000, limit: 10 });
    if (n) app.log.info(`reconciled ${n} purchase(s)`);
  } catch (err) {
    app.log.error(err, "reconcile failed");
  } finally {
    busy = false;
  }
}, 30_000);
timer.unref();
app.addHook("onClose", async () => clearInterval(timer));

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
