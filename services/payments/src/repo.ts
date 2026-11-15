// Purchases storage. Table `purchases` is created by Agent A's migrations (docs/data-model.md).
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Purchase } from "@faze/shared";

export interface PurchaseRow {
  id: string;
  userId: string;
  stripeSessionId: string;
  stripeEventId: string | null;
  bundleId: string;
  coins: number;
  amountCents: number;
  testMode: boolean;
  status: "pending" | "paid" | "failed";
  createdAt: string;
}

export interface NewPurchase {
  userId: string;
  stripeSessionId: string;
  bundleId: string;
  coins: number;
  amountCents: number;
}

export interface PurchaseRepo {
  create(p: NewPurchase): Promise<PurchaseRow>;
  findBySession(sessionId: string): Promise<PurchaseRow | undefined>;
  /** Marks a pending purchase paid. Returns false if it was already paid (replay). */
  markPaid(sessionId: string, eventId: string): Promise<boolean>;
  listForUser(userId: string): Promise<PurchaseRow[]>;
}

export function toApi(r: PurchaseRow): Purchase {
  return {
    id: r.id,
    bundleId: r.bundleId,
    coins: r.coins,
    amountCents: r.amountCents,
    testMode: r.testMode,
    status: r.status,
    createdAt: r.createdAt,
  };
}

// ---------- Postgres ----------
type DbRow = {
  id: string;
  user_id: string;
  stripe_session_id: string;
  stripe_event_id: string | null;
  bundle_id: string;
  coins: number;
  amount_cents: number;
  test_mode: boolean;
  status: PurchaseRow["status"];
  created_at: Date;
};

const COLS = "id, user_id, stripe_session_id, stripe_event_id, bundle_id, coins, amount_cents, test_mode, status, created_at";

function fromDb(r: DbRow): PurchaseRow {
  return {
    id: r.id,
    userId: r.user_id,
    stripeSessionId: r.stripe_session_id,
    stripeEventId: r.stripe_event_id,
    bundleId: r.bundle_id,
    coins: r.coins,
    amountCents: r.amount_cents,
    testMode: r.test_mode,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

export function pgRepo(pool: pg.Pool): PurchaseRepo {
  return {
    async create(p) {
      const { rows } = await pool.query<DbRow>(
        `INSERT INTO purchases (id, user_id, stripe_session_id, bundle_id, coins, amount_cents, test_mode, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'pending', now()) RETURNING ${COLS}`,
        [randomUUID(), p.userId, p.stripeSessionId, p.bundleId, p.coins, p.amountCents],
      );
      return fromDb(rows[0]!);
    },
    async findBySession(sessionId) {
      const { rows } = await pool.query<DbRow>(`SELECT ${COLS} FROM purchases WHERE stripe_session_id = $1`, [sessionId]);
      return rows[0] ? fromDb(rows[0]) : undefined;
    },
    async markPaid(sessionId, eventId) {
      const res = await pool.query(
        `UPDATE purchases SET status = 'paid', stripe_event_id = $2 WHERE stripe_session_id = $1 AND status <> 'paid'`,
        [sessionId, eventId],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async listForUser(userId) {
      const { rows } = await pool.query<DbRow>(
        `SELECT ${COLS} FROM purchases WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return rows.map(fromDb);
    },
  };
}

// ---------- in-memory (unit tests, and local dev before A's migration lands) ----------
export function memoryRepo(): PurchaseRepo & { rows: PurchaseRow[] } {
  const rows: PurchaseRow[] = [];
  return {
    rows,
    async create(p) {
      const row: PurchaseRow = {
        id: randomUUID(),
        ...p,
        stripeEventId: null,
        testMode: true,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    },
    async findBySession(sessionId) {
      return rows.find((r) => r.stripeSessionId === sessionId);
    },
    async markPaid(sessionId, eventId) {
      const r = rows.find((x) => x.stripeSessionId === sessionId);
      if (!r || r.status === "paid") return false;
      r.status = "paid";
      r.stripeEventId = eventId;
      return true;
    },
    async listForUser(userId) {
      return rows.filter((r) => r.userId === userId).reverse();
    },
  };
}
