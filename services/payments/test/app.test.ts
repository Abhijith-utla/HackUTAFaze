import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { memoryLedger } from "../src/ledger.js";
import { memoryRepo } from "../src/repo.js";
import { makeGateway } from "../src/stripe.js";

const JWT_SECRET = "test-jwt-secret";
const CLIENT = "http://localhost:3000";

async function token(sub: string, role: "fan" | "admin" = "fan") {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function setup() {
  const repo = memoryRepo();
  const ledger = memoryLedger();
  const gateway = makeGateway({
    stripeMode: "fake",
    stripeSecretKey: "sk_test_fake",
    stripeWebhookSecret: "whsec_test",
    paymentsUrl: "http://localhost:4100",
  });
  const app = buildApp({ repo, ledger, gateway, jwtSecret: JWT_SECRET, clientUrl: CLIENT });
  return { app, repo, ledger, gateway };
}

function completedEvent(sessionId: string, userId: string, eventId = `evt_${randomUUID()}`) {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: sessionId, payment_status: "paid", metadata: { userId } } },
  });
}

describe("payments", () => {
  let t: ReturnType<typeof setup>;
  const userId = randomUUID();
  beforeEach(() => {
    t = setup();
  });

  async function checkout(bundleId = "coins_1000", uid = userId) {
    const res = await t.app.inject({
      method: "POST",
      url: "/payments/checkout",
      cookies: { session: await token(uid) },
      payload: { bundleId },
    });
    return res;
  }

  function webhook(payload: string, sig = t.gateway.sign(payload)) {
    return t.app.inject({
      method: "POST",
      url: "/payments/webhook",
      headers: { "content-type": "application/json", "stripe-signature": sig },
      payload,
    });
  }

  it("lists bundles in test mode", async () => {
    const res = await t.app.inject({ method: "GET", url: "/payments/bundles" });
    expect(res.statusCode).toBe(200);
    expect(res.json().testMode).toBe(true);
    expect(res.json().bundles.length).toBeGreaterThan(0);
  });

  it("checkout requires a session", async () => {
    const res = await t.app.inject({ method: "POST", url: "/payments/checkout", payload: { bundleId: "coins_1000" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a forged session token", async () => {
    const forged = await new SignJWT({ role: "fan" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("wrong-secret"));
    const res = await t.app.inject({ method: "POST", url: "/payments/checkout", cookies: { session: forged }, payload: { bundleId: "coins_1000" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects unknown bundles", async () => {
    const res = await checkout("coins_999999");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("creates a pending purchase and returns a checkout url", async () => {
    const res = await checkout();
    expect(res.statusCode).toBe(200);
    expect(res.json().checkoutUrl).toMatch(/\/payments\/fake-checkout\/cs_fake_/);
    expect(t.repo.rows).toHaveLength(1);
    expect(t.repo.rows[0]!.status).toBe("pending");
    expect(t.repo.rows[0]!.testMode).toBe(true);
  });

  it("credits coins once on a valid webhook, and a replay does not double-credit", async () => {
    await checkout();
    const sessionId = t.repo.rows[0]!.stripeSessionId;
    const payload = completedEvent(sessionId, userId, "evt_same");

    const first = await webhook(payload);
    expect(first.statusCode).toBe(200);
    expect(first.json().credited).toBe(1000);
    expect(t.ledger.balances.get(userId)).toBe(1000);

    const replay = await webhook(payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().duplicate).toBe(true);

    // A different event id for the same session also must not double-credit.
    const other = await webhook(completedEvent(sessionId, userId));
    expect(other.statusCode).toBe(200);
    expect(t.ledger.balances.get(userId)).toBe(1000);
    expect(t.repo.rows[0]!.status).toBe("paid");
  });

  it("concurrent duplicate deliveries still credit once (ledger idempotency key)", async () => {
    await checkout();
    const sessionId = t.repo.rows[0]!.stripeSessionId;
    await Promise.all([webhook(completedEvent(sessionId, userId)), webhook(completedEvent(sessionId, userId))]);
    expect(t.ledger.balances.get(userId)).toBe(1000);
  });

  it("rejects an invalid signature and credits nothing", async () => {
    await checkout();
    const payload = completedEvent(t.repo.rows[0]!.stripeSessionId, userId);
    const res = await webhook(payload, "t=1,v1=deadbeef");
    expect(res.statusCode).toBe(400);
    expect(t.ledger.balances.size).toBe(0);
  });

  it("rejects a tampered payload", async () => {
    await checkout();
    const payload = completedEvent(t.repo.rows[0]!.stripeSessionId, userId);
    const sig = t.gateway.sign(payload);
    const res = await webhook(payload.replace("paid", "PAID"), sig);
    expect(res.statusCode).toBe(400);
    expect(t.ledger.balances.size).toBe(0);
  });

  it("ignores events for unknown sessions and user mismatches", async () => {
    const unknown = await webhook(completedEvent("cs_unknown", userId));
    expect(unknown.json().ignored).toBe("unknown_session");

    await checkout();
    const mismatch = await webhook(completedEvent(t.repo.rows[0]!.stripeSessionId, randomUUID()));
    expect(mismatch.json().ignored).toBe("user_mismatch");
    expect(t.ledger.balances.size).toBe(0);
  });

  it("returns 502 when the ledger is down so Stripe retries, then succeeds on retry", async () => {
    let down = true;
    const real = t.ledger.credit.bind(t.ledger);
    t.ledger.credit = async (b) => {
      if (down) throw new Error("api down");
      return real(b);
    };
    await checkout();
    const payload = completedEvent(t.repo.rows[0]!.stripeSessionId, userId);
    expect((await webhook(payload)).statusCode).toBe(502);
    expect(t.repo.rows[0]!.status).toBe("pending");
    down = false;
    expect((await webhook(payload)).statusCode).toBe(200);
    expect(t.ledger.balances.get(userId)).toBe(1000);
  });

  it("fake checkout page completes through the signed webhook path", async () => {
    const url = new URL((await checkout()).json().checkoutUrl);
    const page = await t.app.inject({ method: "GET", url: url.pathname });
    expect(page.body).toContain("TEST MODE");
    const pay = await t.app.inject({
      method: "POST",
      url: url.pathname,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "action=pay",
    });
    expect(pay.statusCode).toBe(302);
    expect(pay.headers.location).toContain(`${CLIENT}/store?purchase=success`);
    expect(t.ledger.balances.get(userId)).toBe(1000);
  });

  it("lists only the caller's purchases", async () => {
    await checkout();
    await checkout("coins_2500", randomUUID());
    const res = await t.app.inject({ method: "GET", url: "/me/purchases", cookies: { session: await token(userId) } });
    expect(res.json().purchases).toHaveLength(1);
    expect(res.json().purchases[0].testMode).toBe(true);
  });
});

describe("config", () => {
  const base = { DATABASE_URL: "postgres://x", JWT_SECRET: "j", INTERNAL_SECRET: "i" };
  it("refuses a non-test Stripe key", () => {
    expect(() => loadConfig({ ...base, STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_x" })).toThrow(/test-mode/);
  });
  it("defaults to fake mode", () => {
    expect(loadConfig(base).stripeMode).toBe("fake");
  });
});
