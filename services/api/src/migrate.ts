import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "./db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Applies migrations/*.sql in name order, once each. Safe to run concurrently (advisory lock). */
export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(424242)");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
    const done = new Set((await c.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const f of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(424242)").catch(() => {});
    c.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await migrate();
  console.log("migrations applied");
  await pool.end();
}
