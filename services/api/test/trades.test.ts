import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, makeSetWithPack, pool, signup } from "./helpers.js";

let app: FastifyInstance;
let cardId: string;

beforeAll(async () => {
  app = await makeApp();
  cardId = (await makeSetWithPack()).cardIds[0];
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function give(ownerId: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO card_instances (card_id, owner_id, serial)
     VALUES ($1, $2, (SELECT COALESCE(MAX(serial),0)+1 FROM card_instances WHERE card_id=$1)) RETURNING id`,
    [cardId, ownerId],
  );
  return r.rows[0].id;
}

const owner = async (id: string) =>
  (await pool.query("SELECT owner_id, locked_by_trade_id FROM card_instances WHERE id=$1", [id])).rows[0];

async function setup(message?: string) {
  const a = await signup(app, "Alice");
  const b = await signup(app, "Bob");
  const ai = await give(a.id);
  const bi = await give(b.id);
  const res = await app.inject({
    method: "POST",
    url: "/trades",
    headers: { cookie: a.cookie },
    payload: { toUserId: b.id, offeredInstanceIds: [ai], requestedInstanceIds: [bi], ...(message ? { message } : {}) },
  });
  return { a, b, ai, bi, res, tradeId: res.json().trade?.id as string };
}

const act = (id: string, action: string, cookie: string) =>
  app.inject({ method: "POST", url: `/trades/${id}/${action}`, headers: { cookie } });

describe("trades", () => {
  it("create locks both sides", async () => {
    const { res, ai, bi, tradeId } = await setup();
    expect(res.statusCode).toBe(201);
    expect(res.json().trade.status).toBe("open");
    expect((await owner(ai)).locked_by_trade_id).toBe(tradeId);
    expect((await owner(bi)).locked_by_trade_id).toBe(tradeId);
  });

  it("offering a locked card → CARD_LOCKED", async () => {
    const { a, ai } = await setup();
    const c = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: "/trades",
      headers: { cookie: a.cookie },
      payload: { toUserId: c.id, offeredInstanceIds: [ai], requestedInstanceIds: [] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CARD_LOCKED");
  });

  it("rejects unowned cards and self trades", async () => {
    const a = await signup(app);
    const b = await signup(app);
    const bi = await give(b.id);
    const notMine = await app.inject({
      method: "POST",
      url: "/trades",
      headers: { cookie: a.cookie },
      payload: { toUserId: b.id, offeredInstanceIds: [bi], requestedInstanceIds: [] },
    });
    expect(notMine.statusCode).toBe(404);
    const self = await app.inject({
      method: "POST",
      url: "/trades",
      headers: { cookie: a.cookie },
      payload: { toUserId: a.id, offeredInstanceIds: [], requestedInstanceIds: [bi] },
    });
    expect(self.statusCode).toBe(400);
  });

  it("accept swaps owners and clears locks; listed in /me/trades", async () => {
    const { a, b, ai, bi, tradeId } = await setup();
    const inbox = await app.inject({ method: "GET", url: "/me/trades", headers: { cookie: b.cookie } });
    expect(inbox.json().incoming.map((t: any) => t.id)).toContain(tradeId);
    const out = await app.inject({ method: "GET", url: "/me/trades", headers: { cookie: a.cookie } });
    expect(out.json().outgoing.map((t: any) => t.id)).toContain(tradeId);

    const res = await act(tradeId, "accept", b.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().trade.status).toBe("accepted");
    expect(await owner(ai)).toEqual({ owner_id: b.id, locked_by_trade_id: null });
    expect(await owner(bi)).toEqual({ owner_id: a.id, locked_by_trade_id: null });
    const again = await act(tradeId, "accept", b.cookie);
    expect(again.json().error.code).toBe("TRADE_NOT_OPEN");
  });

  it("notifies both parties on offer, accept, decline and cancel; accept stamps acquired_at", async () => {
    const kinds = async (userId: string) =>
      (await pool.query("SELECT kind FROM notifications WHERE user_id=$1 ORDER BY created_at, id", [userId])).rows.map((r) => r.kind);
    const t1 = await setup();
    expect(await kinds(t1.b.id)).toEqual(["offer_received"]);
    const before = (await pool.query("SELECT acquired_at FROM card_instances WHERE id=$1", [t1.ai])).rows[0].acquired_at;
    expect((await act(t1.tradeId, "accept", t1.b.cookie)).statusCode).toBe(200);
    expect(await kinds(t1.a.id)).toEqual(["trade_completed"]);
    expect(await kinds(t1.b.id)).toEqual(["offer_received", "trade_completed"]);
    const after = (await pool.query("SELECT acquired_at FROM card_instances WHERE id=$1", [t1.ai])).rows[0].acquired_at;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    const feed = await app.inject({ method: "GET", url: "/me/notifications", headers: { cookie: t1.a.cookie } });
    expect(feed.statusCode).toBe(200);

    const t2 = await setup();
    expect((await act(t2.tradeId, "decline", t2.b.cookie)).statusCode).toBe(200);
    expect(await kinds(t2.a.id)).toEqual(["offer_closed"]);
    const t3 = await setup();
    expect((await act(t3.tradeId, "cancel", t3.a.cookie)).statusCode).toBe(200);
    expect(await kinds(t3.b.id)).toEqual(["offer_received", "offer_closed"]);
    // A rejected action (wrong party) must not leave a notification behind.
    const t4 = await setup();
    expect((await act(t4.tradeId, "accept", t4.a.cookie)).statusCode).toBe(403);
    expect(await kinds(t4.a.id)).toEqual([]);
  });

  it("concurrent accepts → exactly one success", async () => {
    const { b, tradeId } = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => act(tradeId, "accept", b.cookie)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error.code === "TRADE_NOT_OPEN")).toBe(true);
  });

  it("decline (recipient) and cancel (sender) unlock; wrong party FORBIDDEN", async () => {
    const t1 = await setup();
    expect((await act(t1.tradeId, "decline", t1.a.cookie)).statusCode).toBe(403);
    const d = await act(t1.tradeId, "decline", t1.b.cookie);
    expect(d.json().trade.status).toBe("declined");
    expect((await owner(t1.ai)).locked_by_trade_id).toBeNull();
    expect((await owner(t1.bi)).locked_by_trade_id).toBeNull();

    const t2 = await setup();
    expect((await act(t2.tradeId, "cancel", t2.b.cookie)).statusCode).toBe(403);
    const c = await act(t2.tradeId, "cancel", t2.a.cookie);
    expect(c.json().trade.status).toBe("cancelled");
    expect((await owner(t2.ai)).locked_by_trade_id).toBeNull();
  });

  it("non-party cannot act", async () => {
    const { tradeId } = await setup();
    const x = await signup(app);
    for (const action of ["accept", "decline", "cancel"]) {
      expect((await act(tradeId, action, x.cookie)).statusCode).toBe(403);
    }
  });

  it("message creates pending submission, hidden from recipient until approved", async () => {
    const { a, b, tradeId } = await setup("gg trade?");
    const sub = await pool.query("SELECT kind, status, payload FROM submissions WHERE ref_id=$1", [tradeId]);
    expect(sub.rows).toEqual([{ kind: "trade_message", status: "pending", payload: { message: "gg trade?" } }]);

    const find = async (cookie: string, box: "incoming" | "outgoing") =>
      (await app.inject({ method: "GET", url: "/me/trades", headers: { cookie } })).json()[box].find((t: any) => t.id === tradeId);
    expect((await find(b.cookie, "incoming")).message).toBeNull();
    expect((await find(a.cookie, "outgoing")).message).toBe("gg trade?");

    await pool.query("UPDATE trades SET message_status='approved' WHERE id=$1", [tradeId]);
    expect((await find(b.cookie, "incoming")).message).toBe("gg trade?");
  });
});
