import { LedgerCreditBody } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import { requireInternal } from "../auth.js";
import { tx } from "../db.js";
import { postEntry } from "../ledger.js";

export async function internalRoutes(app: FastifyInstance) {
  // Service-to-service only (services/payments). Idempotent on idempotencyKey.
  app.post("/internal/ledger/credit", async (req) => {
    requireInternal(req);
    const b = LedgerCreditBody.parse(req.body);
    const out = await tx((c) =>
      postEntry(c, {
        userId: b.userId,
        amount: b.amount,
        reason: b.reason,
        refId: b.refId,
        idempotencyKey: b.idempotencyKey,
        demo: true, // test-mode payments only
      }),
    );
    return { balance: out.balance };
  });
}
