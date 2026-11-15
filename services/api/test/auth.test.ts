import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { cookieFrom, makeApp, pool, signup } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("auth + /me", () => {
  it("signup grants 500 demo coins, sets cookie, queues display name for moderation", async () => {
    const u = await signup(app, "Rug");
    expect(u.cookie).toMatch(/^session=/);
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie: u.cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().balance).toBe(500);
    expect(me.json().user.displayNameStatus).toBe("pending");
    const sub = await pool.query("SELECT kind, status FROM submissions WHERE user_id=$1", [u.id]);
    expect(sub.rows).toEqual([{ kind: "display_name", status: "pending" }]);
    const led = await pool.query("SELECT demo, reason FROM ledger WHERE user_id=$1", [u.id]);
    expect(led.rows).toEqual([{ demo: true, reason: "signup_bonus" }]);
  });

  it("duplicate email → 409 CONFLICT", async () => {
    const u = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: u.email, password: "password123", displayName: "Dup" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("validation errors use the envelope", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/signup", payload: { email: "nope" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("login + logout", async () => {
    const u = await signup(app);
    const bad = await app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, password: "wrong" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, password: "password123" } });
    expect(ok.statusCode).toBe(200);
    expect(cookieFrom(ok)).toMatch(/^session=/);
    const out = await app.inject({ method: "POST", url: "/auth/logout" });
    expect(out.statusCode).toBe(204);
  });

  it("/me without cookie → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });
});

describe("internal ledger credit", () => {
  it("rejects without secret", async () => {
    const res = await app.inject({ method: "POST", url: "/internal/ledger/credit", payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("credits once per idempotency key", async () => {
    const u = await signup(app);
    const payload = { userId: u.id, amount: 1000, reason: "purchase", refId: "evt_1", idempotencyKey: `evt_${randomUUID()}` };
    const headers = { "x-internal-secret": "test-internal-secret" };
    const a = await app.inject({ method: "POST", url: "/internal/ledger/credit", payload, headers });
    const b = await app.inject({ method: "POST", url: "/internal/ledger/credit", payload, headers });
    expect(a.statusCode).toBe(200);
    expect(a.json().balance).toBe(1500);
    expect(b.json().balance).toBe(1500);
  });

  it("concurrent replays still credit once", async () => {
    const u = await signup(app);
    const payload = { userId: u.id, amount: 250, reason: "purchase", refId: "x", idempotencyKey: `evt_${randomUUID()}` };
    const headers = { "x-internal-secret": "test-internal-secret" };
    await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: "POST", url: "/internal/ledger/credit", payload, headers })),
    );
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie: u.cookie } });
    expect(me.json().balance).toBe(750);
  });
});
