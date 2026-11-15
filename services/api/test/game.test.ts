import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { makeApp, makeSetWithPack, pool, signup } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
  // Only this file's daily pack should be live, so rotation is deterministic.
  await pool.query("UPDATE packs SET active=false WHERE kind='daily'");
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
const post = (url: string, cookie: string, payload: Record<string, unknown> = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload });

/** A live era set whose cards are all common, so one pack reliably completes it. */
async function eraSet(bonus = 250, cardCount = 2) {
  const { setId, packId, cardIds } = await makeSetWithPack({
    perPack: 10,
    odds: { common: 100 },
    cards: Array.from({ length: cardCount }, () => ({ rarity: "common" })),
  });
  await pool.query("UPDATE card_sets SET era='2010–2012', backstory='The story behind the set.', completion_bonus=$2 WHERE id=$1", [setId, bonus]);
  return { setId, packId, cardIds };
}

describe("GET /sets", () => {
  it("lists live sets with their full checklist and never the backstory", async () => {
    const { setId, cardIds } = await eraSet();
    const res = await get("/sets");
    expect(res.statusCode).toBe(200);
    const set = res.json().sets.find((s: any) => s.id === setId);
    expect(set).toMatchObject({ era: "2010–2012", completionBonus: 250, drop: false });
    expect(set.cards.map((c: any) => c.id).sort()).toEqual([...cardIds].sort());
    expect(JSON.stringify(set)).not.toContain("The story behind the set.");
  });
});

describe("set completion", () => {
  it("progress counts distinct moments; claim refuses until complete, then pays once", async () => {
    const { setId, packId } = await eraSet(250, 2);
    const u = await signup(app);

    const before = (await get("/me/sets", u.cookie)).json().progress.find((p: any) => p.setId === setId);
    expect(before).toMatchObject({ owned: 0, total: 2, complete: false, claimed: false, backstory: null });

    const early = await post(`/me/sets/${setId}/claim`, u.cookie);
    expect(early.statusCode).toBe(400);

    // 10 commons from a 2-card all-common set: both moments owned (probability of missing one is 2/1024).
    let p = before;
    for (let i = 0; i < 3 && !p.complete; i++) {
      expect((await post(`/packs/${packId}/open`, u.cookie, { idempotencyKey: randomUUID() })).statusCode).toBe(200);
      p = (await get("/me/sets", u.cookie)).json().progress.find((x: any) => x.setId === setId);
    }
    expect(p).toMatchObject({ owned: 2, complete: true, backstory: "The story behind the set." });

    const balance = (await get("/me", u.cookie)).json().balance;
    const claim = await post(`/me/sets/${setId}/claim`, u.cookie);
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({ bonus: 250, balance: balance + 250, backstory: "The story behind the set." });

    const again = await post(`/me/sets/${setId}/claim`, u.cookie);
    expect(again.json()).toMatchObject({ bonus: 0, balance: balance + 250 });
    const ledger = await pool.query("SELECT COUNT(*)::int AS n FROM ledger WHERE user_id=$1 AND reason='set_bonus'", [u.id]);
    expect(ledger.rows[0].n).toBe(1);
  });

  it("requires a session", async () => {
    const { setId } = await eraSet();
    expect((await app.inject({ method: "POST", url: `/me/sets/${setId}/claim` })).statusCode).toBe(401);
  });
});

describe("daily pack", () => {
  it("is free, once per UTC day, replay-safe, and hidden from the store", async () => {
    const { setId } = await eraSet(0, 3);
    const daily = await pool.query(
      "INSERT INTO packs (set_id, name, price_coins, cards_per_pack, odds, odds_version, kind) VALUES ($1,'Daily test',100,5,$2,1,'daily') RETURNING id",
      [setId, { common: 100 }],
    );
    const dailyId = daily.rows[0].id;
    const u = await signup(app);

    const status = (await get("/me/daily", u.cookie)).json();
    expect(status).toMatchObject({ available: true });
    expect(status.pack.id).toBe(dailyId);

    const key = randomUUID();
    const first = await post("/me/daily/open", u.cookie, { idempotencyKey: key });
    expect(first.statusCode).toBe(200);
    expect(first.json().cards).toHaveLength(5);
    expect(first.json().balance).toBe(500); // free: no debit

    const replay = await post("/me/daily/open", u.cookie, { idempotencyKey: key });
    expect(replay.json().pullId).toBe(first.json().pullId);

    const second = await post("/me/daily/open", u.cookie, { idempotencyKey: randomUUID() });
    expect(second.statusCode).toBe(409);

    const after = (await get("/me/daily", u.cookie)).json();
    expect(after.available).toBe(false);
    expect(Date.parse(after.nextAt)).toBeGreaterThan(Date.now());

    expect((await get("/packs")).json().packs.some((p: any) => p.id === dailyId)).toBe(false);
    expect((await post(`/packs/${dailyId}/open`, u.cookie, { idempotencyKey: randomUUID() })).statusCode).toBe(404);

    const mine = (await get("/me/cards", u.cookie)).json().cards.reduce((n: number, e: any) => n + e.count, 0);
    expect(mine).toBe(5);
  });
});
