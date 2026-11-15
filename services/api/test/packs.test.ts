import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { makeApp, makeSetWithPack, pool, signup } from "./helpers.js";
import { pickCard, rollRarity, type CardSlot } from "../src/pulls.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const open = (packId: string, cookie: string, key = randomUUID()) =>
  app.inject({ method: "POST", url: `/packs/${packId}/open`, headers: { cookie }, payload: { idempotencyKey: key } });

describe("rollRarity / pickCard", () => {
  it("10k rolls match published odds within tolerance", () => {
    const odds = { common: 70, rare: 20, epic: 8, legendary: 2 };
    const n = 10_000;
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < n; i++) counts[rollRarity(odds)]++;
    for (const [r, pct] of Object.entries(odds)) expect(Math.abs(counts[r] / n - pct / 100)).toBeLessThan(0.02);
  });

  it("sold out → same rarity, then lower, then null", () => {
    const cards: CardSlot[] = [
      { id: "L", rarity: "legendary", maxSupply: 1, minted: 1 },
      { id: "E", rarity: "epic", maxSupply: 1, minted: 0 },
    ];
    expect(pickCard(cards, "legendary")!.id).toBe("E");
    expect(pickCard(cards, "legendary")).toBeNull();
  });
});

describe("packs", () => {
  it("GET /packs lists live packs with odds", async () => {
    const { packId } = await makeSetWithPack();
    const res = await app.inject({ method: "GET", url: "/packs" });
    const p = res.json().packs.find((x: any) => x.id === packId);
    expect(p).toMatchObject({ priceCoins: 100, cardsPerPack: 5, oddsVersion: 1 });
  });

  it("open debits coins, mints 5 serialized cards, logs the pull", async () => {
    const { packId } = await makeSetWithPack();
    const u = await signup(app);
    const res = await open(packId, u.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cards).toHaveLength(5);
    expect(body.balance).toBe(400);
    const pull = await pool.query("SELECT odds_version, card_instance_ids FROM pulls WHERE id=$1", [body.pullId]);
    expect(pull.rows[0].odds_version).toBe(1);
    expect(pull.rows[0].card_instance_ids).toHaveLength(5);
    const mine = await app.inject({ method: "GET", url: "/me/cards", headers: { cookie: u.cookie } });
    const total = mine.json().cards.reduce((n: number, e: any) => n + e.count, 0);
    expect(total).toBe(5);
  });

  it("same idempotencyKey → same pull, charged once", async () => {
    const { packId } = await makeSetWithPack();
    const u = await signup(app);
    const key = randomUUID();
    const a = await open(packId, u.cookie, key);
    const b = await open(packId, u.cookie, key);
    expect(b.json().pullId).toBe(a.json().pullId);
    expect(b.json().balance).toBe(400);
  });

  it("insufficient coins → 409, no cards", async () => {
    const { packId } = await makeSetWithPack({ price: 600 });
    const u = await signup(app);
    const res = await open(packId, u.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INSUFFICIENT_COINS");
    const n = await pool.query("SELECT COUNT(*)::int AS n FROM card_instances WHERE owner_id=$1", [u.id]);
    expect(n.rows[0].n).toBe(0);
  });

  it("concurrent opens never overdraw", async () => {
    const { packId } = await makeSetWithPack({ price: 150 });
    const u = await signup(app);
    const results = await Promise.all(Array.from({ length: 6 }, () => open(packId, u.cookie)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie: u.cookie } });
    expect(me.json().balance).toBe(50);
  });

  it("sold out set → 409 CONFLICT, no debit; serials unique", async () => {
    const { packId } = await makeSetWithPack({ perPack: 3, cards: [{ rarity: "common", maxSupply: 4 }] });
    const u = await signup(app);
    const first = await open(packId, u.cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json().cards.map((c: any) => c.serial).sort()).toEqual([1, 2, 3]);
    const second = await open(packId, u.cookie); // only 1 left, needs 3
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");
    const me = await app.inject({ method: "GET", url: "/me", headers: { cookie: u.cookie } });
    expect(me.json().balance).toBe(400);
  });

  it("unknown pack → 404", async () => {
    const u = await signup(app);
    const res = await open(randomUUID(), u.cookie);
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /users?q=", () => {
  it("returns approved names by prefix, hides pending ones, needs auth", async () => {
    const tag = `Zq${randomUUID().slice(0, 6)}`;
    const a = await signup(app, `${tag}Alpha`);
    const b = await signup(app, `${tag}Beta`);
    await pool.query("UPDATE users SET display_name_status='approved' WHERE id=$1", [a.id]);
    const res = await app.inject({ method: "GET", url: `/users?q=${tag}`, headers: { cookie: b.cookie } });
    expect(res.json().users).toEqual([{ id: a.id, displayName: `${tag}Alpha` }]);
    expect((await app.inject({ method: "GET", url: "/users?q=x" })).statusCode).toBe(401);
  });
});

describe("collection + leaderboard", () => {
  it("GET /cards/:id returns hype; public collection works; leaderboard scores by rarity", async () => {
    const { packId, cardIds } = await makeSetWithPack({ perPack: 2, odds: { legendary: 100 }, cards: [{ rarity: "legendary" }] });
    await pool.query("INSERT INTO card_stats (card_id, hype) VALUES ($1, 100) ON CONFLICT (card_id) DO UPDATE SET hype=100", [
      cardIds[0],
    ]);
    const u = await signup(app);
    expect((await open(packId, u.cookie)).statusCode).toBe(200);

    const card = await app.inject({ method: "GET", url: `/cards/${cardIds[0]}` });
    expect(card.json().stats.hype).toBe(100);

    const pub = await app.inject({ method: "GET", url: `/users/${u.id}/collection` });
    expect(pub.json().cards[0].count).toBe(2);

    const lb = await app.inject({ method: "GET", url: "/leaderboard" });
    const me = lb.json().collectors.find((x: any) => x.user.id === u.id);
    if (me) {
      expect(me.score).toBe(50);
      expect(me.user.displayName).toBe("New collector"); // name pending moderation
    }
    expect(lb.json().trending.some((t: any) => t.card.id === cardIds[0])).toBe(true);
  });
});
