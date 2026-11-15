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
  /** Atomically reserve a verified signature before any ledger side effect. */
  reserveSignature(id: string, signature: string): Promise<boolean>;
  pending(): Promise<PurchaseRow[]>;
  /** True if this signature already paid for some purchase. */
  signatureUsed(signature: string): Promise<boolean>;
  /** Marks a pending purchase paid. Returns false if it was already paid. */
  markPaid(id: string, signature: string): Promise<boolean>;
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
        const r = await pool.query("UPDATE purchases SET tx_signature=$2 WHERE id=$1 AND status='pending' AND (tx_signature IS NULL OR tx_signature=$2) RETURNING id", [id, signature]);
        return !!r.rowCount;
      } catch (error) {
        if ((error as { code?: string }).code === '23505') return false;
        throw error;
      }
    },
    async pending() {
      const r = await pool.query<DbRow>(`SELECT ${COLS} FROM purchases WHERE status='pending' ORDER BY created_at`);
      return r.rows.map(fromDb);
    },
    async signatureUsed(signature) {
      const { rowCount } = await pool.query(`SELECT 1 FROM purchases WHERE tx_signature = $1`, [signature]);
      return (rowCount ?? 0) > 0;
    },
    async pendingSince(since, limit) {
      const { rows } = await pool.query<DbRow>(
        `SELECT ${COLS} FROM purchases WHERE status = 'pending' AND created_at >= $1 ORDER BY created_at LIMIT $2`,
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
      const row = rows.find(r => r.id === id);
      if (!row || row.status !== 'pending' || (row.txSignature && row.txSignature !== signature)) return false;
      if (rows.some(r => r.id !== id && r.txSignature === signature)) return false;
      row.txSignature = signature;
      return true;
    },
    async pending(limit = 100) { return rows.filter(r => r.status === 'pending'); },
    async signatureUsed(signature) {
      return rows.some((r) => r.txSignature === signature);
    },
    async markPaid(id, signature) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status === "paid") return false;
      if (rows.some((x) => x.id !== id && x.txSignature === signature)) return false;
      r.status = "paid";
      r.txSignature = signature;
      return true;
    },
    async pendingSince(since, limit) {
      return rows.filter((r) => r.status === "pending" && new Date(r.createdAt) >= since).slice(0, limit);
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
