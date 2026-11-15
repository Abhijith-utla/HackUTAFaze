// Purchases storage. Table `purchases` is created by Agent A's migrations (docs/data-model.md).
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Purchase, SolanaCluster } from "@faze/shared";

export interface PurchaseRow {
  id: string;
  userId: string;
  bundleId: string;
  coins: number;
  lamports: number;
  reference: string;
  recipient: string;
  txSignature: string | null;
  cluster: SolanaCluster;
  testMode: boolean;
  status: "pending" | "paid" | "expired";
  createdAt: string;
  paidAt: string | null;
}

export type NewPurchase = Pick<PurchaseRow, "userId" | "bundleId" | "coins" | "lamports" | "reference" | "recipient" | "cluster">;

export interface PurchaseRepo {
  create(p: NewPurchase): Promise<PurchaseRow>;
  get(id: string): Promise<PurchaseRow | undefined>;
  /**
   * Atomically attach a VERIFIED signature to a pending purchase before any ledger side effect.
   * False if the purchase is not pending, already holds a different signature, or the signature
   * is attached to another purchase (unique constraint).
   */
  reserveSignature(id: string, signature: string): Promise<boolean>;
  /** Pending purchases created after `since`, oldest first (for reconciliation). */
  pendingSince(since: Date, limit: number): Promise<PurchaseRow[]>;
  /** Marks a pending purchase (with a reserved signature) paid. Returns false if it was already paid. */
  markPaid(id: string): Promise<boolean>;
  listForUser(userId: string): Promise<PurchaseRow[]>;
}

export function toApi(r: PurchaseRow): Purchase {
  return {
    id: r.id,
    bundleId: r.bundleId,
    coins: r.coins,
    lamports: r.lamports,
    reference: r.reference,
    txSignature: r.txSignature,
    cluster: r.cluster,
    testMode: r.testMode,
    status: r.status,
    createdAt: r.createdAt,
    paidAt: r.paidAt,
  };
}

// ---------- Postgres ----------
type DbRow = {
  id: string;
  user_id: string;
  bundle_id: string;
  coins: number;
  lamports: string | number; // bigint comes back as string
  reference: string;
  recipient: string;
  tx_signature: string | null;
  cluster: SolanaCluster;
  test_mode: boolean;
  status: PurchaseRow["status"];
  created_at: Date;
  paid_at: Date | null;
};

const COLS = "id, user_id, bundle_id, coins, lamports, reference, recipient, tx_signature, cluster, test_mode, status, created_at, paid_at";

function fromDb(r: DbRow): PurchaseRow {
  return {
    id: r.id,
    userId: r.user_id,
    bundleId: r.bundle_id,
    coins: r.coins,
    lamports: Number(r.lamports),
    reference: r.reference,
    recipient: r.recipient,
    txSignature: r.tx_signature,
    cluster: r.cluster,
    testMode: r.test_mode,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  };
}

export function pgRepo(pool: pg.Pool): PurchaseRepo {
  return {
    async create(p) {
      const { rows } = await pool.query<DbRow>(
        `INSERT INTO purchases (id, user_id, bundle_id, coins, lamports, reference, recipient, cluster, test_mode, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'pending', now()) RETURNING ${COLS}`,
        [randomUUID(), p.userId, p.bundleId, p.coins, p.lamports, p.reference, p.recipient, p.cluster],
      );
      return fromDb(rows[0]!);
    },
    async get(id) {
      const { rows } = await pool.query<DbRow>(`SELECT ${COLS} FROM purchases WHERE id = $1`, [id]);
      return rows[0] ? fromDb(rows[0]) : undefined;
    },
    async reserveSignature(id, signature) {
      try {
        const res = await pool.query(
          `UPDATE purchases SET tx_signature = $2
           WHERE id = $1 AND status = 'pending' AND (tx_signature IS NULL OR tx_signature = $2)`,
          [id, signature],
        );
        return (res.rowCount ?? 0) > 0;
      } catch (err) {
        if ((err as { code?: string }).code === "23505") return false; // signature belongs to another purchase
        throw err;
      }
    },
    async pendingSince(since, limit) {
      const { rows } = await pool.query<DbRow>(
        `SELECT ${COLS} FROM purchases WHERE status = 'pending' AND bundle_id NOT LIKE 'pack:%' AND (created_at >= $1 OR tx_signature IS NOT NULL) ORDER BY (tx_signature IS NULL), created_at LIMIT $2`,
        [since, limit],
      );
      return rows.map(fromDb);
    },
    async markPaid(id) {
      const res = await pool.query(
        `UPDATE purchases SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'pending' AND tx_signature IS NOT NULL`,
        [id],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async listForUser(userId) {
      const { rows } = await pool.query<DbRow>(`SELECT ${COLS} FROM purchases WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      return rows.map(fromDb);
    },
  };
}

// ---------- in-memory (unit tests, and standalone dev before A's migration lands) ----------
export function memoryRepo(): PurchaseRepo & { rows: PurchaseRow[] } {
  const rows: PurchaseRow[] = [];
  return {
    rows,
    async create(p) {
      const row: PurchaseRow = {
        id: randomUUID(),
        ...p,
        txSignature: null,
        testMode: true,
        status: "pending",
        createdAt: new Date().toISOString(),
        paidAt: null,
      };
      rows.push(row);
      return row;
    },
    async get(id) {
      return rows.find((r) => r.id === id);
    },
    async reserveSignature(id, signature) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== "pending" || (r.txSignature && r.txSignature !== signature)) return false;
      if (rows.some((x) => x.id !== id && x.txSignature === signature)) return false;
      r.txSignature = signature;
      return true;
    },
    async pendingSince(since, limit) {
      return rows.filter((r) => r.status === "pending" && !r.bundleId.startsWith("pack:") && (new Date(r.createdAt) >= since || r.txSignature !== null)).sort((a,b) => Number(a.txSignature === null) - Number(b.txSignature === null)).slice(0, limit);
    },
    async markPaid(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== "pending" || !r.txSignature) return false;
      r.status = "paid";
      r.paidAt = new Date().toISOString();
      return true;
    },
    async listForUser(userId) {
      return rows.filter((r) => r.userId === userId).reverse();
    },
  };
}
