// End-to-end demo flow (master.md §2) against real api + payments processes and Postgres.
// Steps whose endpoints Agent A hasn't shipped yet are SKIPPED (shown in the report), never faked.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { SIGNUP_BONUS_COINS } from "@faze/shared";
import { Fan, routeExists } from "./client.js";

const apiUrl = inject("apiUrl");
const paymentsUrl = inject("paymentsUrl");
const newFan = () => new Fan(apiUrl, paymentsUrl);
const simSignature = (reference: string, lamports: number) => `sim_${reference}_${lamports}`;

let has: Record<"packs" | "collection" | "trades" | "leaderboard" | "admin" | "users", boolean>;

beforeAll(async () => {
  has = {
    packs: await routeExists(`${apiUrl}/packs`),
    collection: await routeExists(`${apiUrl}/me/cards`),
    trades: await routeExists(`${apiUrl}/me/trades`),
    leaderboard: await routeExists(`${apiUrl}/leaderboard`),
    admin: await routeExists(`${apiUrl}/admin/sets`),
    users: await routeExists(`${apiUrl}/users?q=it`),
  };
  console.log("[integration] live endpoints:", has);
});

async function buy(fan: Fan, bundleId = "coins_1000") {
  const c = await fan.pay("POST", "/payments/checkout", { bundleId });
  expect(c.status).toBe(200);
  const conf = await fan.pay("POST", "/payments/confirm", {
    purchaseId: c.body.purchaseId,
    signature: simSignature(c.body.reference, c.body.lamports),
  });
  return { checkout: c.body, confirm: conf };
}

async function openFirstPack(fan: Fan) {
  const packs = await fan.api("GET", "/packs");
  expect(packs.status).toBe(200);
  const pack = packs.body.packs[0];
  if (!pack) return undefined;
  return { pack, res: await fan.api("POST", `/packs/${pack.id}/open`, { idempotencyKey: randomUUID() }) };
}

describe("1. signup + starter coins", () => {
  it("new fan gets the signup bonus and a session", async () => {
    const fan = newFan();
    await fan.signup();
    expect(await fan.balance()).toBe(SIGNUP_BONUS_COINS);
  });

  it("logged-out calls are rejected", async () => {
    const anon = newFan();
    expect((await anon.api("GET", "/me")).status).toBe(401);
    expect((await anon.pay("POST", "/payments/checkout", { bundleId: "coins_1000" })).status).toBe(401);
  });
});

describe("4. buy coins (Phantom/Solana devnet, simulated chain in tests)", () => {
  it("verified payment credits coins exactly once through the API ledger", async () => {
    const fan = newFan();
    await fan.signup();
    const { checkout, confirm } = await buy(fan);
    expect(checkout.cluster).toBe("devnet");
    expect(confirm.status).toBe(200);
    expect(confirm.body).toMatchObject({ status: "paid", credited: 1000, balance: SIGNUP_BONUS_COINS + 1000 });

    const again = await fan.pay("POST", "/payments/confirm", {
      purchaseId: checkout.purchaseId,
      signature: simSignature(checkout.reference, checkout.lamports),
    });
    expect(again.body.credited).toBe(0);
    expect(await fan.balance()).toBe(SIGNUP_BONUS_COINS + 1000);

    const history = await fan.pay("GET", "/me/purchases");
    expect(history.body.purchases[0]).toMatchObject({ status: "paid", testMode: true, cluster: "devnet" });
  });

  it("underpayment and reused signatures are rejected", async () => {
    const fan = newFan();
    await fan.signup();
    const a = (await fan.pay("POST", "/payments/checkout", { bundleId: "coins_1000" })).body;
    const under = await fan.pay("POST", "/payments/confirm", { purchaseId: a.purchaseId, signature: simSignature(a.reference, a.lamports - 1) });
    expect(under.status).toBe(400);

    const sig = simSignature(a.reference, a.lamports);
    expect((await fan.pay("POST", "/payments/confirm", { purchaseId: a.purchaseId, signature: sig })).status).toBe(200);
    const b = (await fan.pay("POST", "/payments/checkout", { bundleId: "coins_1000" })).body;
    expect((await fan.pay("POST", "/payments/confirm", { purchaseId: b.purchaseId, signature: sig })).status).toBe(400);
    expect(await fan.balance()).toBe(SIGNUP_BONUS_COINS + 1000);
  });

  it("a fan cannot confirm another fan's purchase", async () => {
    const a = newFan();
    const b = newFan();
    await a.signup();
    await b.signup();
    const c = (await a.pay("POST", "/payments/checkout", { bundleId: "coins_1000" })).body;
    const r = await b.pay("POST", "/payments/confirm", { purchaseId: c.purchaseId, signature: simSignature(c.reference, c.lamports) });
    expect(r.status).toBe(404);
    expect(await b.balance()).toBe(SIGNUP_BONUS_COINS);
  });
});

describe("2-3. packs + collection", () => {
  it("opening a pack debits coins and adds cards to the collection", async (ctx) => {
    if (!has.packs || !has.collection) return ctx.skip();
    const fan = newFan();
    await fan.signup();
    await buy(fan);
    const before = await fan.balance();
    const opened = await openFirstPack(fan);
    if (!opened) return ctx.skip(); // no seeded packs yet
    expect(opened.res.status).toBe(200);
    expect(opened.res.body.cards).toHaveLength(opened.pack.cardsPerPack);
    expect(opened.res.body.balance).toBe(before - opened.pack.priceCoins);

    const coll = await fan.api("GET", "/me/cards");
    const owned = coll.body.cards.reduce((n: number, e: { count: number }) => n + e.count, 0);
    expect(owned).toBe(opened.pack.cardsPerPack);
  });

  it("balance never goes negative: opening until broke ends in INSUFFICIENT_COINS", async (ctx) => {
    if (!has.packs) return ctx.skip();
    const fan = newFan();
    await fan.signup();
    let last;
    for (let i = 0; i < 50; i++) {
      const o = await openFirstPack(fan);
      if (!o) return ctx.skip();
      last = o.res;
      if (o.res.status !== 200) break;
    }
    expect(last!.status).toBe(409);
    expect(last!.body.error.code).toBe("INSUFFICIENT_COINS");
    expect(await fan.balance()).toBeGreaterThanOrEqual(0);
  });

  it("the same idempotency key opens the pack once", async (ctx) => {
    if (!has.packs) return ctx.skip();
    const fan = newFan();
    await fan.signup();
    await buy(fan);
    const packs = (await fan.api("GET", "/packs")).body.packs;
    if (!packs[0]) return ctx.skip();
    const key = randomUUID();
    const before = await fan.balance();
    const [a, b] = await Promise.all([
      fan.api("POST", `/packs/${packs[0].id}/open`, { idempotencyKey: key }),
      fan.api("POST", `/packs/${packs[0].id}/open`, { idempotencyKey: key }),
    ]);
    expect([a.status, b.status]).toContain(200);
    expect(await fan.balance()).toBe(before - packs[0].priceCoins);
  });
});

describe("5. trades", () => {
  it("offer → accept swaps cards atomically; accepting twice fails", async (ctx) => {
    if (!has.packs || !has.trades || !has.collection) return ctx.skip();
    const a = newFan();
    const b = newFan();
    await a.signup();
    await b.signup();
    await buy(a);
    await buy(b);
    if (!(await openFirstPack(a)) || !(await openFirstPack(b))) return ctx.skip();

    const aCards = (await a.api("GET", "/me/cards")).body.cards;
    const bCards = (await b.api("GET", "/me/cards")).body.cards;
    const give = aCards[0].instances[0].id;
    const want = bCards[0].instances[0].id;

    const offer = await a.api("POST", "/trades", { toUserId: b.id, offeredInstanceIds: [give], requestedInstanceIds: [want] });
    expect([200, 201]).toContain(offer.status);
    const tradeId = offer.body.trade.id;

    // offered card is locked: can't be offered again
    const dup = await a.api("POST", "/trades", { toUserId: b.id, offeredInstanceIds: [give], requestedInstanceIds: [] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CARD_LOCKED");

    const accept = await b.api("POST", `/trades/${tradeId}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.trade.status).toBe("accepted");

    const again = await b.api("POST", `/trades/${tradeId}/accept`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("TRADE_NOT_OPEN");

    const ids = (cards: any[]) => cards.flatMap((e) => e.instances.map((i: any) => i.id));
    expect(ids((await a.api("GET", "/me/cards")).body.cards)).toContain(want);
    expect(ids((await b.api("GET", "/me/cards")).body.cards)).toContain(give);
    expect(ids((await a.api("GET", "/me/cards")).body.cards)).not.toContain(give);
  });

  it("only the recipient can accept", async (ctx) => {
    if (!has.packs || !has.trades) return ctx.skip();
    const a = newFan();
    const b = newFan();
    await a.signup();
    await b.signup();
    if (!(await openFirstPack(a))) return ctx.skip();
    const give = (await a.api("GET", "/me/cards")).body.cards[0].instances[0].id;
    const offer = await a.api("POST", "/trades", { toUserId: b.id, offeredInstanceIds: [give], requestedInstanceIds: [] });
    const self = await a.api("POST", `/trades/${offer.body.trade.id}/accept`);
    expect([403, 404]).toContain(self.status);
  });
});

describe("6. leaderboard", () => {
  it("returns collectors and trending cards", async (ctx) => {
    if (!has.leaderboard) return ctx.skip();
    const fan = newFan();
    await fan.signup();
    const lb = await fan.api("GET", "/leaderboard");
    expect(lb.status).toBe(200);
    expect(Array.isArray(lb.body.collectors)).toBe(true);
    expect(Array.isArray(lb.body.trending)).toBe(true);
  });
});

describe("7. admin is staff-only", () => {
  it("a fan gets 403 on admin endpoints", async (ctx) => {
    if (!has.admin) return ctx.skip();
    const fan = newFan();
    await fan.signup();
    expect((await fan.api("GET", "/admin/sets")).status).toBe(403);
    expect((await fan.api("POST", "/admin/engagement/spike", { fazeMember: "x" })).status).toBe(403);
  });
});
