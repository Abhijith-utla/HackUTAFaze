// On-chain verification of Phantom payments (Solana Pay "reference" pattern), devnet only.
// The server never trusts the client: it reads the transaction from the RPC and checks it.
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import type { SolanaCluster } from "@faze/shared";

/** The parts of a confirmed transaction we check. */
export interface ChainTx {
  err: unknown | null;
  accountKeys: string[];
  preBalances: number[];
  postBalances: number[];
}

export interface Expected {
  reference: string;
  recipient: string;
  lamports: number;
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** Pure check: did this tx pay `recipient` at least `lamports` and carry `reference`? */
export function checkTransfer(tx: ChainTx, exp: Expected): CheckResult {
  if (tx.err) return { ok: false, reason: "transaction failed on-chain" };
  if (!tx.accountKeys.includes(exp.reference)) return { ok: false, reason: "transaction is not for this purchase (reference missing)" };
  const i = tx.accountKeys.indexOf(exp.recipient);
  if (i < 0) return { ok: false, reason: "transaction does not pay the treasury" };
  const received = (tx.postBalances[i] ?? 0) - (tx.preBalances[i] ?? 0);
  if (received < exp.lamports) return { ok: false, reason: `treasury received ${received} lamports, expected ${exp.lamports}` };
  return { ok: true };
}

export interface ChainReader {
  cluster: SolanaCluster;
  /** Confirmed tx or null if the RPC does not have it (yet). */
  getTx(signature: string): Promise<ChainTx | null>;
  /** Newest confirmed signature that touched `reference`, if any. */
  findSignature(reference: string): Promise<string | undefined>;
}

export function rpcReader(rpcUrl: string, cluster: SolanaCluster): ChainReader {
  const conn = new Connection(rpcUrl, "confirmed");
  return {
    cluster,
    async getTx(signature) {
      const tx = await conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx || !tx.meta) return null;
      return {
        err: tx.meta.err,
        accountKeys: tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()),
        preBalances: tx.meta.preBalances,
        postBalances: tx.meta.postBalances,
      };
    },
    async findSignature(reference) {
      const sigs = await conn.getSignaturesForAddress(new PublicKey(reference), { limit: 5 }, "confirmed");
      return sigs.find((s) => !s.err)?.signature;
    },
  };
}

/**
 * Test-only reader (PAYMENTS_SIMULATE=1): a signature "sim_<reference>_<lamports>" is treated as a
 * confirmed transfer of <lamports> to the treasury carrying <reference>. Labelled simulated; refused in production.
 */
export function simulatedReader(treasury: string, cluster: SolanaCluster): ChainReader {
  const parse = (sig: string) => {
    const m = /^sim_([1-9A-HJ-NP-Za-km-z]{32,44})_(\d+)$/.exec(sig);
    return m ? { reference: m[1]!, lamports: Number(m[2]) } : undefined;
  };
  return {
    cluster,
    async getTx(signature) {
      const p = parse(signature);
      if (!p) return null;
      return { err: null, accountKeys: ["SimPayer1111111111111111111111111111111111", treasury, p.reference], preBalances: [p.lamports, 0, 0], postBalances: [0, p.lamports, 0] };
    },
    async findSignature() {
      return undefined;
    },
  };
}

export function newReference(): string {
  return Keypair.generate().publicKey.toBase58();
}

export function solanaPayUrl(recipient: string, lamports: number, reference: string, cluster: SolanaCluster): string {
  const amount = (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, "");
  const q = new URLSearchParams({
    amount,
    reference,
    label: `FaZe Collector Cards (${cluster})`,
    message: "Test payment — devnet SOL, demo only",
  });
  return `solana:${recipient}?${q.toString()}`;
}
