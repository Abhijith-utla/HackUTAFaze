// Payments HTTP app (docs/api.md "Payments (B)"). Server-authoritative: coins are credited only
// from a signature-verified Stripe webhook, never from anything the client reports.
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { jwtVerify } from "jose";
import {
  CheckoutBody,
  ERROR_STATUS,
  SESSION_COOKIE,
  SessionClaims,
  type ErrorCode,
} from "@faze/shared";
import { BUNDLES, findBundle } from "./bundles.js";
import { toApi, type PurchaseRepo } from "./repo.js";
import type { LedgerClient } from "./ledger.js";
import type { StripeGateway } from "./stripe.js";

export interface AppDeps {
  repo: PurchaseRepo;
  ledger: LedgerClient;
  gateway: StripeGateway;
  jwtSecret: string;
  clientUrl: string;
  logger?: boolean;
}

class HttpError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

const COMPLETED_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false });
  const key = new TextEncoder().encode(deps.jwtSecret);

  app.register(cookie);
  app.register(cors, { origin: deps.clientUrl, credentials: true });

  // Keep the raw body for Stripe signature verification.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      done(new HttpError("VALIDATION", "invalid JSON body"), undefined);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(ERROR_STATUS[err.code]).send({ error: { code: err.code, message: err.message } });
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

  app.get("/health", async () => ({ ok: true, stripeMode: deps.gateway.mode }));

  app.get("/payments/bundles", async () => ({ bundles: BUNDLES, testMode: true as const }));

  app.post("/payments/checkout", async (req) => {
    const user = await requireUser(req);
    const parsed = CheckoutBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError("VALIDATION", "bundleId is required");
    const bundle = findBundle(parsed.data.bundleId);
    if (!bundle) throw new HttpError("VALIDATION", `unknown bundle ${parsed.data.bundleId}`);

    const session = await deps.gateway.createSession({
      userId: user.sub,
      bundle,
      successUrl: `${deps.clientUrl}/store?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${deps.clientUrl}/store?purchase=cancelled`,
    });
    await deps.repo.create({
      userId: user.sub,
      stripeSessionId: session.id,
      bundleId: bundle.id,
      coins: bundle.coins,
      amountCents: bundle.priceCents,
    });
    return { checkoutUrl: session.url };
  });

  app.get("/me/purchases", async (req) => {
    const user = await requireUser(req);
    const rows = await deps.repo.listForUser(user.sub);
    return { purchases: rows.map(toApi) };
  });

  app.post("/payments/webhook", async (req, reply) => {
    const sig = req.headers["stripe-signature"];
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (typeof sig !== "string" || !raw) throw new HttpError("VALIDATION", "missing stripe signature");

    let event;
    try {
      event = deps.gateway.constructEvent(raw, sig);
    } catch {
      throw new HttpError("VALIDATION", "invalid stripe signature");
    }
    return handleEvent(event, reply);
  });

  async function handleEvent(event: ReturnType<StripeGateway["constructEvent"]>, reply: FastifyReply) {
    if (!COMPLETED_EVENTS.has(event.type)) return { received: true, ignored: event.type };
    const session = event.data.object as { id: string; payment_status?: string; metadata?: Record<string, string> | null };
    if (session.payment_status && session.payment_status !== "paid") return { received: true, ignored: "unpaid" };

    // Amount and user come from OUR purchase row, created server-side at checkout — not from metadata.
    const purchase = await deps.repo.findBySession(session.id);
    if (!purchase) {
      app.log.warn({ sessionId: session.id }, "webhook for unknown checkout session");
      return { received: true, ignored: "unknown_session" };
    }
    if (session.metadata?.userId && session.metadata.userId !== purchase.userId) {
      app.log.warn({ sessionId: session.id }, "webhook user mismatch");
      return { received: true, ignored: "user_mismatch" };
    }
    if (purchase.status === "paid") return { received: true, duplicate: true };

    try {
      // Idempotency is per checkout session: replays and duplicate event types credit once.
      await deps.ledger.credit({
        userId: purchase.userId,
        amount: purchase.coins,
        reason: "purchase",
        refId: purchase.id,
        idempotencyKey: `purchase:${session.id}`,
      });
    } catch (err) {
      app.log.error(err, "ledger credit failed; Stripe will retry");
      return reply.status(502).send({ error: { code: "CONFLICT", message: "ledger unavailable, retry" } });
    }
    await deps.repo.markPaid(session.id, event.id);
    return { received: true, credited: purchase.coins };
  }

  // ---------- fake Stripe checkout (STRIPE_MODE=fake only; simulated test payment) ----------
  if (deps.gateway.mode === "fake") {
    app.get<{ Params: { id: string } }>("/payments/fake-checkout/:id", async (req, reply) => {
      const purchase = await deps.repo.findBySession(req.params.id);
      if (!purchase) throw new HttpError("NOT_FOUND", "unknown checkout session");
      const price = (purchase.amountCents / 100).toFixed(2);
      reply.type("text/html").send(`<!doctype html><meta name="viewport" content="width=device-width">
<title>Test checkout</title>
<body style="font-family:system-ui;background:#0b0b0b;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="post" style="background:#161616;padding:32px;border-radius:12px;max-width:360px;text-align:center">
<p style="color:#ff3b3b;font-weight:700;letter-spacing:.08em">TEST MODE — SIMULATED PAYMENT</p>
<h1 style="margin:.2em 0">${purchase.coins.toLocaleString("en-US")} coins</h1>
<p>$${price} — no real money is charged. Demo only.</p>
<button name="action" value="pay" style="background:#e10600;color:#fff;border:0;padding:12px 24px;border-radius:8px;font-size:16px;cursor:pointer">Pay (test)</button>
<button name="action" value="cancel" style="background:none;color:#aaa;border:0;margin-left:8px;cursor:pointer">Cancel</button>
</form></body>`);
    });

    app.post<{ Params: { id: string }; Body: { action?: string } }>("/payments/fake-checkout/:id", async (req, reply) => {
      const purchase = await deps.repo.findBySession(req.params.id);
      if (!purchase) throw new HttpError("NOT_FOUND", "unknown checkout session");
      if (req.body?.action === "cancel") return reply.redirect(`${deps.clientUrl}/store?purchase=cancelled`);

      // Build a real-shaped, signed Stripe event and send it through the same webhook path.
      const payload = JSON.stringify({
        id: `evt_fake_${randomUUID().replace(/-/g, "")}`,
        object: "event",
        type: "checkout.session.completed",
        data: { object: { id: purchase.stripeSessionId, payment_status: "paid", metadata: { userId: purchase.userId, bundleId: purchase.bundleId } } },
      });
      const res = await app.inject({
        method: "POST",
        url: "/payments/webhook",
        headers: { "content-type": "application/json", "stripe-signature": deps.gateway.sign(payload) },
        payload,
      });
      if (res.statusCode !== 200) throw new HttpError("CONFLICT", "simulated payment failed, try again");
      return reply.redirect(`${deps.clientUrl}/store?purchase=success&session_id=${purchase.stripeSessionId}`);
    });
  }

  return app;
}
