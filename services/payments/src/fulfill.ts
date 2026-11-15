import type { PurchaseRepo, PurchaseRow } from './repo.js';
import type { LedgerClient } from './ledger.js';
import { checkTransfer, type ChainReader } from './solana.js';

export class PaymentError extends Error {
  constructor(public code: 'VALIDATION' | 'CONFLICT', message: string) { super(message); }
}

export async function fulfill(repo: PurchaseRepo, ledger: LedgerClient, chain: ChainReader, purchase: PurchaseRow, hint?: string) {
  // A reserved signature has already passed chain verification. Persisting it before
  // credit makes retries safe even after an RPC outage or a process restart.
  if (purchase.status !== 'paid' && !purchase.txSignature) {
    const signature = hint ?? await chain.findSignature(purchase.reference);
    if (!signature) throw new PaymentError('CONFLICT', 'payment not found on-chain yet, retry shortly');
    const tx = await chain.getTx(signature);
    if (!tx) throw new PaymentError('CONFLICT', 'transaction not confirmed yet, retry shortly');
    const check = checkTransfer(tx, purchase);
    if (!check.ok) throw new PaymentError('VALIDATION', check.reason);
    if (!await repo.reserveSignature(purchase.id, signature)) {
      // Another confirm may have completed this same purchase while we verified.
      const current = await repo.get(purchase.id);
      if (!current || current.txSignature !== signature) throw new PaymentError('VALIDATION', 'transaction or purchase already reserved');
    }
    purchase = (await repo.get(purchase.id))!;
  }
  if (!purchase.txSignature) throw new PaymentError('CONFLICT', 'purchase has no verified signature');
  let balance: number;
  try {
    ({ balance } = await ledger.credit({ userId: purchase.userId, amount: purchase.coins,
      reason: 'purchase', refId: purchase.id, idempotencyKey: `purchase:${purchase.id}` }));
  } catch {
    throw new PaymentError('CONFLICT', 'coins service unavailable, retry shortly');
  }
  const first = purchase.status === 'paid' ? false : await repo.markPaid(purchase.id, purchase.txSignature);
  return { status: 'paid' as const, credited: first ? purchase.coins : 0, balance };
}

export async function reconcile(repo: PurchaseRepo, ledger: LedgerClient, chain: ChainReader) {
  const results = [];
  for (const purchase of await repo.pending()) {
    try { results.push(await fulfill(repo, ledger, chain, purchase)); }
    catch (error) { if (!(error instanceof PaymentError)) throw error; }
  }
  return results;
}
