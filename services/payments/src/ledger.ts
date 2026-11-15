// Client for Agent A's internal ledger endpoint. Payments never writes balances itself.
import { INTERNAL_SECRET_HEADER, LedgerCreditResponse, type LedgerCreditBody } from "@faze/shared";

export interface LedgerClient {
  credit(body: LedgerCreditBody): Promise<{ balance: number }>;
}

export function httpLedger(apiUrl: string, internalSecret: string, fetchImpl: typeof fetch = fetch): LedgerClient {
  return {
    async credit(body) {
      const res = await fetchImpl(`${apiUrl}/internal/ledger/credit`, {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_SECRET_HEADER]: internalSecret },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`ledger credit failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
      return LedgerCreditResponse.parse(await res.json());
    },
  };
}

/** Stand-in for local dev until A's /internal/ledger/credit lands. Idempotent like the real one. */
export function memoryLedger(): LedgerClient & { balances: Map<string, number>; keys: Set<string> } {
  const balances = new Map<string, number>();
  const keys = new Set<string>();
  return {
    balances,
    keys,
    async credit({ userId, amount, idempotencyKey }) {
      if (!keys.has(idempotencyKey)) {
        keys.add(idempotencyKey);
        balances.set(userId, (balances.get(userId) ?? 0) + amount);
      }
      return { balance: balances.get(userId) ?? 0 };
    },
  };
}
