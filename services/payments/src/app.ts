// Payments HTTP app (docs/api.md "Payments (B)"): Phantom wallet + Solana, devnet only.
// Server-authoritative: coins are credited only after the server reads the transaction on-chain.
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { jwtVerify } from "jose";
import { CheckoutBody, ConfirmBody, ERROR_STATUS, SESSION_COOKIE, SessionClaims, type ErrorCode } from "@faze/shared";
import { BUNDLES, findBundle } from "./bundles.js";
import { toApi, type PurchaseRepo } from "./repo.js";
import type { LedgerClient } from "./ledger.js";
import { checkTransfer, newReference, solanaPayUrl, type ChainReader } from "./solana.js";

export interface AppDeps {
  repo: PurchaseRepo;
  ledger: LedgerClient;
  chain: ChainReader;
  treasury: string;
  jwtSecret: string;
  clientUrl: string;
  logger?: boolean;
}

export class HttpError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

// Real Solana signatures are base58 (64-88 chars); "sim_<reference>_<lamports>" is the test-only simulated form.
const SIGNATURE_RE = /^(?:[1-9A-HJ-NP-Za-km-z]{32,90}|sim_[1-9A-HJ-NP-Za-km-z]{32,44}_\d{1,19})$/;

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false });
  const key = new TextEncoder().encode(deps.jwtSecret);

  app.register(cookie);
  app.register(cors, { origin: deps.clientUrl, credentials: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(ERROR_STATUS[err.code]).send({ error: { code: err.code, message: err.message } });
    }
    if ((err as { statusCode?: number }).statusCode === 400) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: err.message } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: "CONFLICT", message: "internal error" } });
  });

  async function requireUser(req: FastifyRequest): Promise<SessionClaims> {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw new HttpError("UNAUTHENTICATED", "log in first");
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
      return SessionClaims.parse(payload);
    } catch {
      throw new HttpError("UNAUTHENTICATED", "invalid or expired session");
    }
  }

  app.get("/health", async () => ({ ok: true, cluster: deps.chain.cluster }));

  app.get("/payments/bundles", async () => ({
    bundles: BUNDLES,
    cluster: deps.chain.cluster,
    recipient: deps.treasury,
    testMode: true as const,
  }));

  app.post("/payments/checkout", async (req) => {
    const user = await requireUser(req);
    const parsed = CheckoutBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError("VALIDATION", "bundleId is required");
    const bundle = findBundle(parsed.data.bundleId);
    if (!bundle) throw new HttpError("VALIDATION", `unknown bundle ${parsed.data.bundleId}`);

    const reference = newReference();
    const purchase = await deps.repo.create({
      userId: user.sub,
      bundleId: bundle.id,
      coins: bundle.coins,
      lamports: bundle.lamports,
      reference,
      recipient: deps.treasury,
      cluster: deps.chain.cluster,
    });
    return {
      purchaseId: purchase.id,
      recipient: purchase.recipient,
      lamports: purchase.lamports,
      reference,
      cluster: purchase.cluster,
      solanaPayUrl: solanaPayUrl(purchase.recipient, purchase.lamports, reference, purchase.cluster),
    };
  });

  app.post("/payments/confirm", async (req) => {
    const user = await requireUser(req);
    const parsed = ConfirmBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError("VALIDATION", "purchaseId (uuid) is required");
    const purchase = await deps.repo.get(parsed.data.purchaseId);
    if (!purchase || purchase.userId !== user.sub) throw new HttpError("NOT_FOUND", "purchase not found");

    const credit = () =>
      deps.ledger.credit({
        userId: purchase.userId,
        amount: purchase.coins,
        reason: "purchase",
        refId: purchase.id,
        idempotencyKey: `purchase:${purchase.id}`,
      });

    if (purchase.status === "paid") {
      // Idempotent: return the current balance without crediting again.
      const { balance } = await credit();
      return { status: "paid" as const, credited: 0, balance };
    }

    let signature = parsed.data.signature;
    if (signature !== undefined && !SIGNATURE_RE.test(signature)) throw new HttpError("VALIDATION", "malformed signature");
    const rpc = async <T>(f: () => Promise<T>): Promise<T> => {
      try {
        return await f();
      } catch (err) {
        app.log.warn(err, "solana rpc error");
        throw new HttpError("CONFLICT", "Solana RPC unavailable, retry shortly");
      }
    };
    if (!signature) signature = await rpc(() => deps.chain.findSignature(purchase.reference));
    if (!signature) throw new HttpError("CONFLICT", "payment not found on-chain yet, retry shortly");
    if (await deps.repo.signatureUsed(signature)) throw new HttpError("VALIDATION", "this transaction already paid for a purchase");

    const sigToCheck = signature;
    const tx = await rpc(() => deps.chain.getTx(sigToCheck));
    if (!tx) throw new HttpError("CONFLICT", "transaction not confirmed yet, retry shortly");
    const check = checkTransfer(tx, { reference: purchase.reference, recipient: purchase.recipient, lamports: purchase.lamports });
    if (!check.ok) throw new HttpError("VALIDATION", check.reason);

    let balance: number;
    try {
      ({ balance } = await credit());
    } catch (err) {
      app.log.error(err, "ledger credit failed");
      throw new HttpError("CONFLICT", "coins service unavailable, retry shortly");
    }
    const first = await deps.repo.markPaid(purchase.id, signature);
    return { status: "paid" as const, credited: first ? purchase.coins : 0, balance };
  });

  app.get("/me/purchases", async (req) => {
    const user = await requireUser(req);
    const rows = await deps.repo.listForUser(user.sub);
    return { purchases: rows.map(toApi) };
  });

  return app;
}
