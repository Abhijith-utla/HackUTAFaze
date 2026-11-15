import "dotenv/config";
import pg from "pg";
import { processOne, tick } from "./jobs.mjs";
const url = process.env.DATABASE_URL;
if (!url) throw Error("DATABASE_URL is required");
const parsed = new URL(url);
if (
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) &&
  !["require", "verify-ca", "verify-full"].includes(
    parsed.searchParams.get("sslmode"),
  )
)
  throw Error("Remote Tiger Cloud connections require TLS");
const seconds = Number(process.env.ENGAGEMENT_SIM_INTERVAL_SECONDS ?? 30);
if (!Number.isFinite(seconds) || seconds < 1)
  throw Error("ENGAGEMENT_SIM_INTERVAL_SECONDS must be at least 1");
const pool = new pg.Pool({ connectionString: url, max: 4 });
let stopped = false;
let lastSimulation = 0;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
  });
console.log(
  "Demo worker: simulated engagement, moderation flags, durable jobs",
);
try {
  while (!stopped) {
    try {
      for (let i = 0; i < 20 && !stopped && (await processOne(pool)); i++);
      const due = Date.now() - lastSimulation >= seconds * 1000;
      await tick(pool, due);
      if (due) lastSimulation = Date.now();
    } catch (error) {
      console.error("Worker cycle failed:", error.message);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
} finally {
  await pool.end();
}
