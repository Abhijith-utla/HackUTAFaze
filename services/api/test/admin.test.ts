import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeAdmin, makeApp, makeSetWithPack, pool, signup } from "./helpers.js";

let app: FastifyInstance;
let admin: { id: string; cookie: string };
beforeAll(async () => {
  app = await makeApp();
  admin = await makeAdmin();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const as = (cookie: string) => ({ headers: { cookie } });

describe("admin auth", () => {
  it("no cookie → 401, fan → 403", async () => {
    const none = await app.inject({ method: "GET", url: "/admin/sets" });
    expect(none.statusCode).toBe(401);
    const fan = await signup(app);
    const res = await app.inject({ method: "GET", url: "/admin/sets", ...as(fan.cookie) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    const spike = await app.inject({
      method: "POST",
      url: "/admin/engagement/spike",
      payload: { fazeMember: "FaZe Rug" },
      ...as(fan.cookie),
    });
    expect(spike.statusCode).toBe(403);
  });
});

describe("sets → cards → packs → publish", () => {
  it("happy path", async () => {
    const s = await app.inject({
      method: "POST",
      url: "/admin/sets",
      payload: { name: "Admin Test Set", description: "x" },
      ...as(admin.cookie),
    });
    expect(s.statusCode).toBe(201);
    const set = s.json().set;
    expect(set.status).toBe("draft");

    const c = await app.inject({
      method: "POST",
      url: "/admin/cards",
      payload: { setId: set.id, name: "Rug Pull", fazeMember: "FaZe Rug", rarity: "rare", artUrl: "https://a/x.png", basePower: 30 },
      ...as(admin.cookie),
    });
    expect(c.statusCode).toBe(201);
    const card = c.json().card;
    const stats = await pool.query("SELECT hype FROM card_stats WHERE card_id=$1", [card.id]);
    expect(stats.rows[0].hype).toBe(0);

    const pc = await app.inject({
      method: "PATCH",
      url: `/admin/cards/${card.id}`,
      payload: { basePower: 35 },
      ...as(admin.cookie),
    });
    expect(pc.json().card.basePower).toBe(35);

    const p = await app.inject({
      method: "POST",
      url: "/admin/packs",
      payload: { setId: set.id, name: "P", priceCoins: 100, cardsPerPack: 5, odds: { common: 70, rare: 20, epic: 8, legendary: 2 } },
      ...as(admin.cookie),
    });
    expect(p.statusCode).toBe(201);
    expect(p.json().pack.oddsVersion).toBe(1);

    const pp = await app.inject({
      method: "PATCH",
      url: `/admin/packs/${p.json().pack.id}`,
      payload: { odds: { common: 60, rare: 30, epic: 8, legendary: 2 } },
      ...as(admin.cookie),
    });
    expect(pp.json().pack.oddsVersion).toBe(2);

    const pub = await app.inject({ method: "POST", url: `/admin/sets/${set.id}/publish`, ...as(admin.cookie) });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().set.status).toBe("live");
    expect(pub.json().set.publishedAt).not.toBeNull();
    const job = await pool.query("SELECT 1 FROM jobs WHERE kind='publish_set' AND payload->>'setId'=$1", [set.id]);
    expect(job.rowCount).toBe(1);

    const list = await app.inject({ method: "GET", url: `/admin/cards?setId=${set.id}`, ...as(admin.cookie) });
    expect(list.json().cards).toHaveLength(1);
  });

  it("pack odds not summing to 100 → VALIDATION", async () => {
    const { setId } = await makeSetWithPack();
    const res = await app.inject({
      method: "POST",
      url: "/admin/packs",
      payload: { setId, name: "Bad", priceCoins: 100, cardsPerPack: 5, odds: { common: 50, rare: 20 } },
      ...as(admin.cookie),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("publish fails when a card has no art or pack odds are bad", async () => {
    const a = await makeSetWithPack();
    await pool.query("UPDATE cards SET art_url='' WHERE id=$1", [a.cardIds[0]]);
    const r1 = await app.inject({ method: "POST", url: `/admin/sets/${a.setId}/publish`, ...as(admin.cookie) });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().error.message).toMatch(/art/);

    const b = await makeSetWithPack({ odds: { common: 50, rare: 20 } });
    const r2 = await app.inject({ method: "POST", url: `/admin/sets/${b.setId}/publish`, ...as(admin.cookie) });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().error.message).toMatch(/odds/);
  });
});

describe("moderation", () => {
  it("approving a display_name updates the user; second decision → CONFLICT", async () => {
    const fan = await signup(app, "NiceName");
    const list = await app.inject({ method: "GET", url: "/admin/moderation?status=pending", ...as(admin.cookie) });
    expect(list.statusCode).toBe(200);
    const sub = list.json().submissions.find((s: any) => s.userId === fan.id && s.kind === "display_name");
    expect(sub).toBeTruthy();

    const dec = await app.inject({
      method: "POST",
      url: `/admin/moderation/${sub.id}`,
      payload: { decision: "approve" },
      ...as(admin.cookie),
    });
    expect(dec.statusCode).toBe(200);
    expect(dec.json().submission.status).toBe("approved");
    expect(dec.json().submission.reviewedBy).toBe(admin.id);
    const u = await pool.query("SELECT display_name_status FROM users WHERE id=$1", [fan.id]);
    expect(u.rows[0].display_name_status).toBe("approved");

    const again = await app.inject({
      method: "POST",
      url: `/admin/moderation/${sub.id}`,
      payload: { decision: "reject" },
      ...as(admin.cookie),
    });
    expect(again.statusCode).toBe(409);
  });
});

describe("engagement spike", () => {
  it("inserts a queued engagement_spike job", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/engagement/spike",
      payload: { fazeMember: "FaZe Rug" },
      ...as(admin.cookie),
    });
    expect(res.statusCode).toBe(201);
    const j = await pool.query("SELECT kind, status, payload FROM jobs WHERE id=$1", [res.json().jobId]);
    expect(j.rows[0]).toEqual({ kind: "engagement_spike", status: "queued", payload: { fazeMember: "FaZe Rug" } });
  });
});

describe("publish guard", () => {
  it("PATCH status=live cannot bypass publish validation", async () => {
    const adm = await makeAdmin();
    const created = await app.inject({ method: "POST", url: "/admin/sets", headers: { cookie: adm.cookie }, payload: { name: "Draft guard", description: "" } });
    const id = created.json().set.id;
    const patch = await app.inject({ method: "PATCH", url: `/admin/sets/${id}`, headers: { cookie: adm.cookie }, payload: { status: "live" } });
    expect(patch.statusCode).toBe(400);
    const row = await pool.query("SELECT status, published_at FROM card_sets WHERE id=$1", [id]);
    expect(row.rows[0]).toEqual({ status: "draft", published_at: null });
  });
});
