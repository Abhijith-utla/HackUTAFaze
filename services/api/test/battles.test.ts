import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, pool, signup } from "./helpers.js";
import { resolve, type Fighter } from "../src/battle/resolve.js";
import { BATTLE_RULES } from "../src/battle/rules.js";
import { battleStats } from "../src/battle/stats.js";
import { toFighters } from "../src/battle/vault.js";

// ---------- pure: stat model + resolver (design "Game logic v1" §1, §2) ----------

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(here, "..", "..", "..", "content", "seed", "catalog.json"), "utf8"));
const setName = Object.fromEntries(catalog.sets.map((s: any) => [s.id, s.name]));
const byName = (n: string) => {
  const c = catalog.cards.find((x: any) => x.name === n);
  if (!c) throw new Error(`catalog card ${n} missing`);
  return c;
};
const statsOf = (n: string, hype = 0, serial = 50) => battleStats({ ...byName(n), setName: setName[byName(n).setId] }, { serial }, hype);
const fighter = (n: string): Fighter => ({ setKey: byName(n).setId, member: byName(n).fazeMember, stats: statsOf(n) });

const YOU = ["Rain / OG Era 3", "Apex / OG Era 2", "Banks / OG Era 1"].map(fighter);
const GHOST = ["Apex / Creators 7", "Banks / Creators 6", "Rug / Esports Moments 5"].map(fighter);
const seedN = (i: number) => i.toString(16).padStart(32, "0");

describe("battle stats", () => {
  it("matches the design's derived stat table (hype 0, non-low serial)", () => {
    const table: [string, number, number, number, number][] = [
      ["Banks / OG Era 1", 17, 21, 37, 12],
      ["Apex / OG Era 2", 48, 47, 44, 22],
      ["Rain / OG Era 3", 64, 71, 63, 32],
      ["Adapt / OG Era 4", 77, 78, 99, 42],
      ["Banks / OG Era 6", 38, 42, 62, 22],
      ["Apex / OG Era 7", 72, 68, 62, 32],
      ["Rain / OG Era 8", 80, 93, 86, 42],
      ["Apex / OG Era 12", 86, 85, 84, 42],
      ["Rain / OG Era 13", 20, 29, 24, 12],
      ["Apex / Creators 12", 94, 89, 77, 48],
      ["Rain / Esports Moments 8", 86, 99, 76, 42],
    ];
    for (const [n, p, c, s, h] of table) {
      const st = statsOf(n);
      expect([n, st.power, st.clutch, st.style, st.hype]).toEqual([n, p, c, s, h]);
    }
    expect(statsOf("Rain / OG Era 3").role).toBe("og");
    expect(statsOf("Apex / OG Era 2").role).toBe("founder");
    expect(statsOf("Adapt / OG Era 4").cost).toBe(4);
  });

  it("hype spike raises HYPE (design: Rain OG Era 3 32 → 77 at hype 90)", () => {
    expect(statsOf("Rain / OG Era 3", 90).hype).toBe(77);
  });

  it("serial perks: #1 +3, #2-10 +1, unknown member → creator", () => {
    const base = statsOf("Apex / OG Era 2");
    const first = statsOf("Apex / OG Era 2", 0, 1);
    const low = statsOf("Apex / OG Era 2", 0, 7);
    expect([first.power - base.power, first.clutch - base.clutch, first.style - base.style, first.perk]).toEqual([3, 3, 3, "first_edition"]);
    expect([low.power - base.power, low.perk]).toEqual([1, "low_serial"]);
    expect(battleStats({ id: randomUUID(), basePower: 45, rarity: "rare", fazeMember: "Someone New" }, null, 0).role).toBe("creator");
  });
});

describe("battle resolver", () => {
  it("is deterministic: same seed → identical log; different seeds vary", () => {
    const s = "0123456789abcdef0123456789abcdef";
    expect(resolve(s, YOU, GHOST)).toEqual(resolve(s, YOU, GHOST));
    const outcomes = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(resolve(seedN(i + 1), YOU, GHOST).rounds)));
    expect(outcomes.size).toBeGreaterThan(30);
  });

  it("worked example: structure, synergies, point values and re-resolution", () => {
    const seed = "0000000f66617a652d64656d6f000000";
    const r = resolve(seed, YOU, GHOST);
    expect(r.playerSynergy).toEqual([{ label: "ERA STACK", value: 6 }, { label: "FULL SQUAD", value: 4 }]);
    expect(r.opponentSynergy).toEqual([{ label: "ERA PAIR", value: 3 }, { label: "FULL SQUAD", value: 4 }]);
    expect(r.rounds.map((x) => [x.n, x.slot])).toEqual([[1, "opener"], [2, "mid"], [3, "closer"]]);
    expect(new Set(r.rounds.map((x) => x.stat)).size).toBe(3);
    for (const [i, round] of r.rounds.entries()) {
      for (const side of ["player", "opponent"] as const) {
        const x = round[side];
        expect(x.cardIndex).toBe(i);
        expect(x.base).toBe((side === "player" ? YOU : GHOST)[i].stats[round.stat]);
        expect(x.swing).toBeGreaterThanOrEqual(0);
        expect(x.swing).toBeLessThanOrEqual(BATTLE_RULES.swing);
        expect(x.total).toBe(x.base + x.bonuses.reduce((s, b) => s + b.value, 0) + x.swing + (x.trickshot ? 12 : 0) + x.clutch);
        if (i < 2) expect(x.clutch).toBe(0);
      }
      expect(round.points).toBe(round.winner === "tie" ? 0 : [1, 1, 2][i]);
    }
    expect(r.playerPoints + r.opponentPoints).toBeLessThanOrEqual(4);
    // golden log for this seed (xoshiro128** v1): changing the RNG or draw order breaks replays
    expect(r.rounds[2]).toMatchObject({ stat: "power", winner: "opponent", points: 2, score: { player: 1, opponent: 3 } });
    expect([r.rounds[2].player.total, r.rounds[2].opponent.total]).toEqual([29, 36]);
    expect(r.result).toBe("loss");
    expect(resolve(seed, YOU, GHOST)).toEqual(r);
  });

  it("clutch: only the side behind before round 3 gets 6 + floor(HYPE*0.3)", () => {
    let seen = 0;
    for (let i = 1; i < 400 && seen < 5; i++) {
      const r = resolve(seedN(i), YOU, GHOST);
      const before = r.rounds[1].score;
      for (const side of ["player", "opponent"] as const) {
        const other = side === "player" ? "opponent" : "player";
        const c = r.rounds[2][side].clutch;
        if (before[side] < before[other]) {
          expect(c).toBe(6 + Math.floor((side === "player" ? YOU : GHOST)[2].stats.hype * 0.3));
          seen++;
        } else expect(c).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("tied points are decided by total score (ties on total → challenger)", () => {
    let seen = 0;
    for (let i = 1; i < 600; i++) {
      const r = resolve(seedN(i), YOU, GHOST);
      if (r.playerPoints === r.opponentPoints) {
        seen++;
        expect(r.decidedByTotal).toBe(true);
        expect(r.result).toBe(r.playerTotal >= r.opponentTotal ? "win" : "loss");
      } else expect(r.result).toBe(r.playerPoints > r.opponentPoints ? "win" : "loss");
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("balance: worked-example matchup lands near the design's 56%", () => {
    let w = 0;
    for (let i = 1; i <= 3000; i++) if (resolve(seedN(i * 7919), YOU, GHOST).result === "win") w++;
    expect(w / 3000).toBeGreaterThan(0.5);
    expect(w / 3000).toBeLessThan(0.62);
  });
});

// ---------- API ----------

let app: FastifyInstance;
const cardIds: string[] = [];

beforeAll(async () => {
  app = await makeApp();
  const set = await pool.query(
    "INSERT INTO card_sets (name, status, demo, published_at) VALUES ($1,'live',true,now()) RETURNING id",
    [`Battle Set ${randomUUID().slice(0, 6)}`],
  );
  const specs = [
    ["FaZe Rain", "epic", 65],
    ["FaZe Apex", "rare", 45],
    ["FaZe Banks", "common", 25],
    ["FaZe Adapt", "legendary", 85],
    ["FaZe Rug", "common", 25],
  ] as const;
  for (const [i, [member, rarity, bp]] of specs.entries()) {
    const c = await pool.query(
      "INSERT INTO cards (set_id, name, faze_member, rarity, art_url, base_power, demo) VALUES ($1,$2,$3,$4,'https://example.test/a.png',$5,true) RETURNING id",
      [set.rows[0].id, `Battle Card ${i}`, member, rarity, bp],
    );
    cardIds.push(c.rows[0].id);
  }
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function give(ownerId: string, cardId: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO card_instances (card_id, owner_id, serial)
     VALUES ($1, $2, (SELECT COALESCE(MAX(serial),0)+1 FROM card_instances WHERE card_id=$1)) RETURNING id`,
    [cardId, ownerId],
  );
  return r.rows[0].id;
}

/** Signs up and approves the display name at once, so this file doesn't flood the shared moderation queue. */
async function user(name = "Battler") {
  const u = await signup(app, name);
  await pool.query("UPDATE submissions SET status='approved' WHERE user_id=$1 AND kind='display_name'", [u.id]);
  await pool.query("UPDATE users SET display_name_status='approved' WHERE id=$1", [u.id]);
  return u;
}

async function fan() {
  const u = await user();
  const lineup = [await give(u.id, cardIds[0]), await give(u.id, cardIds[1]), await give(u.id, cardIds[2])];
  return { ...u, lineup };
}

const battle = (cookie: string, payload: object) => app.inject({ method: "POST", url: "/battles", headers: { cookie }, payload });
const get = (cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const key = () => `k_${randomUUID()}`;

describe("battles API", () => {
  it("requires login", async () => {
    for (const url of ["/battle/rules", "/battle/vault", "/me/battle-cards", "/me/battle-progress"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: "POST", url: "/battles", payload: {} })).statusCode).toBe(401);
  });

  it("GET /battle/rules publishes constants + roles", async () => {
    const u = await user();
    const r = (await get(u.cookie, "/battle/rules")).json();
    expect(r.rulesVersion).toBe(1);
    expect(r.constants.roundPoints).toEqual([1, 1, 2]);
    expect(r.roles).toMatchObject({ "FaZe Apex": "founder", "FaZe Rain": "og", "FaZe Banks": "creator" });
  });

  it("GET /me/battle-cards returns instances with battle stats", async () => {
    const u = await fan();
    const r = (await get(u.cookie, "/me/battle-cards")).json();
    expect(r.cards).toHaveLength(3);
    for (const c of r.cards) {
      expect(u.lineup).toContain(c.instanceId);
      expect(c.card.id).toBeTruthy();
      expect(c.stats).toMatchObject({ power: expect.any(Number), clutch: expect.any(Number), style: expect.any(Number), hype: expect.any(Number), cost: expect.any(Number) });
    }
  });

  it("GET /battle/vault returns 4 tiers with attempts", async () => {
    const u = await user();
    const r = (await get(u.cookie, "/battle/vault")).json();
    expect(r.bosses.map((b: any) => b.tier)).toEqual([1, 2, 3, 4]);
    for (const b of r.bosses) {
      expect(b.lineup).toHaveLength(3);
      expect(b.attemptsLeft).toBe(3);
      expect(b.cleared).toBe(false);
      const v = BATTLE_RULES.vault.tiers[b.tier - 1].value;
      expect(b.lineup[0].stats).toMatchObject({ power: v, clutch: v + 4, style: v - 4, hype: v });
    }
    // cached: same bosses on a second call
    const again = (await get(u.cookie, "/battle/vault")).json();
    expect(again.bosses.map((b: any) => b.id)).toEqual(r.bosses.map((b: any) => b.id));
  });

  it("practice battle: 201 with full log; stored snapshot re-resolves identically", async () => {
    const u = await fan();
    const res = await battle(u.cookie, { mode: "practice", lineup: u.lineup, idempotencyKey: key() });
    expect(res.statusCode).toBe(201);
    const b = res.json().battle;
    expect(b).toMatchObject({ mode: "practice", tier: null, rulesVersion: 1 });
    expect(b.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(b.player.lineup.map((x: any) => x.instanceId)).toEqual(u.lineup);
    expect(b.opponent.lineup).toHaveLength(3);
    expect(b.rounds).toHaveLength(3);
    expect(["win", "loss"]).toContain(b.result);
    expect(b.rewards.xp).toBe(b.result === "win" ? 10 : 2);

    const row = (await pool.query("SELECT * FROM battles WHERE id=$1", [b.id])).rows[0];
    const again = resolve(row.seed, toFighters(row.player_lineup), toFighters(row.opponent.lineup));
    expect(again.rounds).toEqual(b.rounds);
    expect(again.result).toBe(b.result);

    const fetched = await get(u.cookie, `/battles/${b.id}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().battle).toEqual(b);
  });

  it("refuses cards you don't own (404) and duplicates (400)", async () => {
    const a = await fan();
    const b = await fan();
    const notMine = await battle(a.cookie, { mode: "practice", lineup: [a.lineup[0], a.lineup[1], b.lineup[2]], idempotencyKey: key() });
    expect(notMine.statusCode).toBe(404);
    expect(notMine.json().error.code).toBe("NOT_FOUND");
    const dup = await battle(a.cookie, { mode: "practice", lineup: [a.lineup[0], a.lineup[0], a.lineup[1]], idempotencyKey: key() });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.code).toBe("VALIDATION");
    const two = await battle(a.cookie, { mode: "practice", lineup: [a.lineup[0], a.lineup[1]], idempotencyKey: key() });
    expect(two.statusCode).toBe(400);
    const noTier = await battle(a.cookie, { mode: "vault", lineup: a.lineup, idempotencyKey: key() });
    expect(noTier.statusCode).toBe(400);
    expect((await pool.query("SELECT count(*)::int AS n FROM battles WHERE user_id=$1", [a.id])).rows[0].n).toBe(0);
  });

  it("idempotent: same key → same battle (200), no second reward", async () => {
    const u = await fan();
    const k = key();
    const first = await battle(u.cookie, { mode: "vault", tier: 1, lineup: u.lineup, idempotencyKey: k });
    expect(first.statusCode).toBe(201);
    const replay = await battle(u.cookie, { mode: "vault", tier: 1, lineup: u.lineup, idempotencyKey: k });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().battle).toEqual(first.json().battle);
    const n = (await pool.query("SELECT count(*)::int AS n FROM battles WHERE user_id=$1", [u.id])).rows[0].n;
    expect(n).toBe(1);
    const p = (await get(u.cookie, "/me/battle-progress")).json();
    expect(p.xp).toBe(first.json().battle.rewards.xp);
    expect(p.wins + p.losses).toBe(1);
  });

  it("vault: 3 attempts per tier per day, parallel requests can't exceed it (409 after)", async () => {
    const u = await fan();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => battle(u.cookie, { mode: "vault", tier: 2, lineup: u.lineup, idempotencyKey: key() })),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(3);
    const rejected = results.filter((r) => r.statusCode !== 201);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.json().error.code).toBe("CONFLICT");
    const tier2 = (await get(u.cookie, "/battle/vault")).json().bosses.find((b: any) => b.tier === 2);
    expect(tier2.attemptsLeft).toBe(0);
    // other tiers unaffected
    expect((await battle(u.cookie, { mode: "vault", tier: 1, lineup: u.lineup, idempotencyKey: key() })).statusCode).toBe(201);
  });

  it("XP + progress: first clear pays tier XP once, wins/losses/clears tracked", async () => {
    const u = await fan();
    let xp = 0;
    let wins = 0;
    const battles: any[] = [];
    for (let i = 0; i < 3; i++) {
      const b = (await battle(u.cookie, { mode: "vault", tier: 1, lineup: u.lineup, idempotencyKey: key() })).json().battle;
      battles.push(b);
      xp += b.rewards.xp;
      if (b.result === "win") wins++;
    }
    const firstWin = battles.findIndex((b) => b.result === "win");
    battles.forEach((b, i) => {
      const expected = b.result === "loss" ? 5 : i === firstWin ? 50 : 10;
      expect(b.rewards.xp).toBe(expected);
    });
    const p = (await get(u.cookie, "/me/battle-progress")).json();
    expect(p).toMatchObject({ xp, wins, losses: 3 - wins, level: 1 + Math.floor(xp / 200) });
    expect(p.vaultClears).toHaveLength(firstWin === -1 ? 0 : 1);
    if (firstWin !== -1) expect(p.vaultClears[0]).toMatchObject({ tier: 1, battleId: battles[firstWin].id });
    const v = (await get(u.cookie, "/battle/vault")).json().bosses.find((b: any) => b.tier === 1);
    expect(v.cleared).toBe(firstWin !== -1);
  });

  it("enforces a tier cost cap only when the tier sets one", async () => {
    const u = await fan(); // epic + rare + common = cost 6
    await get(u.cookie, "/battle/vault");
    const today = new Date().toISOString().slice(0, 10);
    await pool.query("UPDATE vault_bosses SET cost_cap=5 WHERE day=$1::date AND tier=3", [today]);
    try {
      const r = await battle(u.cookie, { mode: "vault", tier: 3, lineup: u.lineup, idempotencyKey: key() });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION");
    } finally {
      await pool.query("UPDATE vault_bosses SET cost_cap=NULL WHERE day=$1::date AND tier=3", [today]);
    }
    expect((await battle(u.cookie, { mode: "vault", tier: 3, lineup: u.lineup, idempotencyKey: key() })).statusCode).toBe(201);
  });

  it("writes no ledger rows and never locks or moves cards", async () => {
    const u = await fan();
    const ledgerBefore = (await pool.query("SELECT count(*)::int AS n FROM ledger WHERE user_id=$1", [u.id])).rows[0].n;
    await battle(u.cookie, { mode: "practice", lineup: u.lineup, idempotencyKey: key() });
    await battle(u.cookie, { mode: "vault", tier: 4, lineup: u.lineup, idempotencyKey: key() });
    const ledgerAfter = (await pool.query("SELECT count(*)::int AS n FROM ledger WHERE user_id=$1", [u.id])).rows[0].n;
    expect(ledgerAfter).toBe(ledgerBefore);
    const inst = await pool.query(
      "SELECT owner_id, locked_by_trade_id, market_listing_id, market_offer_id FROM card_instances WHERE id = ANY($1::uuid[])",
      [u.lineup],
    );
    expect(inst.rows).toHaveLength(3);
    for (const r of inst.rows) expect(r).toEqual({ owner_id: u.id, locked_by_trade_id: null, market_listing_id: null, market_offer_id: null });
    // still tradeable right after a battle
    const other = await user();
    const t = await app.inject({
      method: "POST", url: "/trades", headers: { cookie: u.cookie },
      payload: { toUserId: other.id, offeredInstanceIds: [u.lineup[0]], requestedInstanceIds: [] },
    });
    expect(t.statusCode).toBe(201);
    // and a card reserved by that trade can still battle
    expect((await battle(u.cookie, { mode: "practice", lineup: u.lineup, idempotencyKey: key() })).statusCode).toBe(201);
  });

  it("GET /battles/:id is owner-only", async () => {
    const a = await fan();
    const b = await user();
    const id = (await battle(a.cookie, { mode: "practice", lineup: a.lineup, idempotencyKey: key() })).json().battle.id;
    expect((await get(b.cookie, `/battles/${id}`)).statusCode).toBe(404);
    expect((await get(a.cookie, `/battles/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(a.cookie, `/battles/not-a-uuid`)).statusCode).toBe(400);
  });
});
