import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = pg.PoolClient | pg.Pool;

/** Run fn inside one transaction. Retries on serialization/deadlock errors. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      const code = (e as { code?: string }).code;
      if (attempt < 3 && (code === "40001" || code === "40P01")) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}
