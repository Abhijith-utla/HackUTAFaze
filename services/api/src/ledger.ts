import type pg from "pg";
import { fail } from "./errors.js";

type Reason = "signup_bonus" | "pack_open" | "purchase" | "admin_grant" | "moment_claim";

export async function balanceOf(db: pg.PoolClient | pg.Pool, userId: string): Promise<number> {
  const r = await db.query<{ b: string }>("SELECT COALESCE(SUM(amount),0)::bigint AS b FROM ledger WHERE user_id=$1", [
    userId,
  ]);
  return Number(r.rows[0].b);
}

/** Serialize all balance changes for one user within the current transaction. */
export async function lockUser(c: pg.PoolClient, userId: string) {
  const r = await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
  if (r.rowCount === 0) fail("NOT_FOUND", "User not found");
}

/**
 * Append a ledger entry inside transaction c. Idempotent: if idempotencyKey already exists the
 * existing entry is returned with `replayed: true` and nothing is written.
 * Debits (amount < 0) fail with INSUFFICIENT_COINS if the balance would go negative.
 */
export async function postEntry(
  c: pg.PoolClient,
  e: { userId: string; amount: number; reason: Reason; refId: string | null; idempotencyKey: string; demo?: boolean },
): Promise<{ replayed: boolean; refId: string | null; balance: number }> {
  await lockUser(c, e.userId);
  const prior = await c.query<{ ref_id: string | null; user_id: string }>(
    "SELECT ref_id, user_id FROM ledger WHERE idempotency_key=$1",
    [e.idempotencyKey],
  );
  if (prior.rowCount) {
    if (prior.rows[0].user_id !== e.userId) fail("CONFLICT", "Idempotency key used by another user");
    return { replayed: true, refId: prior.rows[0].ref_id, balance: await balanceOf(c, e.userId) };
  }
  const bal = await balanceOf(c, e.userId);
  if (bal + e.amount < 0) fail("INSUFFICIENT_COINS", `Need ${-e.amount} coins, have ${bal}`);
  await c.query(
    "INSERT INTO ledger (user_id, amount, reason, ref_id, idempotency_key, demo) VALUES ($1,$2,$3,$4,$5,$6)",
    [e.userId, e.amount, e.reason, e.refId, e.idempotencyKey, e.demo ?? false],
  );
  return { replayed: false, refId: e.refId, balance: bal + e.amount };
}
