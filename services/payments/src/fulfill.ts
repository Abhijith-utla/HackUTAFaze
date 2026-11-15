// Payment fulfillment: verify on-chain → RESERVE the signature on the purchase row → credit → mark paid.
// Reserving before the ledger side effect closes a check-then-act race (one tx carrying two purchase
// references, confirmed concurrently) — credit to @tanejakeshav's review in PR #3.
import type { ErrorCode } from "@faze/shared";
import type { LedgerClient } from "./ledger.js";
import type { PurchaseRepo, PurchaseRow } from "./repo.js";
import { checkTransfer, type ChainReader } from "./solana.js";

export class PaymentError extends Error {
  constructor(
    public code: Extract<ErrorCode, "VALIDATION" | "CONFLICT">,
    message: string,
  ) {
    super(message);
  }
}

async function rpc<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch {
    throw new PaymentError("CONFLICT", "Solana RPC unavailable, retry shortly");
  }
}

export async function fulfill(
  repo: PurchaseRepo,
  ledger: LedgerClient,
  chain: ChainReader,
  purchase: PurchaseRow,
  hint?: string,
): Promise<{ status: "paid"; credited: number; balance: number }> {
  // A reserved signature already passed verification: retries skip the chain entirely.
  if (purchase.status !== "paid" && !purchase.txSignature) {
    const signature = hint ?? (await rpc(() => chain.findSignature(purchase.reference)));
    if (!signature) throw new PaymentError("CONFLICT", "payment not found on-chain yet, retry shortly");
    const tx = await rpc(() => chain.getTx(signature));
    if (!tx) throw new PaymentError("CONFLICT", "transaction not confirmed yet, retry shortly");
    const check = checkTransfer(tx, purchase);
    if (!check.ok) throw new PaymentError("VALIDATION", check.reason);
    if (!(await repo.reserveSignature(purchase.id, signature))) {
      // Either a concurrent confirm of THIS purchase won (fine), or the tx belongs to another purchase.
      const current = await repo.get(purchase.id);
      if (current?.txSignature !== signature) {
        throw new PaymentError("VALIDATION", "this transaction already paid for a purchase");
      }
    }
    purchase = (await repo.get(purchase.id))!;
  }
  const signature = purchase.txSignature;
  if (!signature) throw new PaymentError("CONFLICT", "purchase has no verified transaction");

  let balance: number;
  try {
    ({ balance } = await ledger.credit({
      userId: purchase.userId,
      amount: purchase.coins,
      reason: "purchase",
      refId: purchase.id,
      idempotencyKey: `purchase:${purchase.id}`,
    }));
  } catch {
    throw new PaymentError("CONFLICT", "coins service unavailable, retry shortly");
  }
  const first = purchase.status !== "paid" && (await repo.markPaid(purchase.id));
  return { status: "paid", credited: first ? purchase.coins : 0, balance };
}

/**
 * Background catch-up for buyers who paid but never reached /payments/confirm (closed tab, crash).
 * Bounded so it never hammers the devnet RPC: only recent pending purchases, a few per tick.
 * Returns how many purchases were newly credited.
 */
export async function reconcile(
  repo: PurchaseRepo,
  ledger: LedgerClient,
  chain: ChainReader,
  opts: { maxAgeMs: number; limit: number },
): Promise<number> {
  let credited = 0;
  for (const p of await repo.pendingSince(new Date(Date.now() - opts.maxAgeMs), opts.limit)) {
    try {
      if ((await fulfill(repo, ledger, chain, p)).credited > 0) credited++;
    } catch (err) {
      if (!(err instanceof PaymentError)) throw err; // not paid yet / RPC hiccup: try next tick
    }
  }
  return credited;
}
