// Control Room analytics + sponsors (lead, contract v1.8).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeAdmin, makeApp, makeSetWithPack, pool, signup } from "./helpers.js";
import { sponsorFit } from "../src/routes/insights.js";

let app: FastifyInstance;
let admin: { id: string; cookie: string };
const as = (cookie: string) => ({ headers: { cookie } });
const get = async (url: string) => (await app.inject({ method: "GET", url, ...as(admin.cookie) })).json();

beforeAll(async () => {
  app = await makeApp();
  admin = await makeAdmin();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("sponsor fit (pure)", () => {
  it("blocks gambling, alcohol, tobacco and vape brands for a youth audience", () => {
    for (const n of ["SuperBet Sportsbook", "Lucky Casino", "Cloud Vape Co", "Frost Beer", "Ace Poker"]) expect(sponsorFit(n).ok).toBe(false);
    for (const n of ["G FUEL", "Champion", "Nissan", "Razer"]) expect(sponsorFit(n).ok).toBe(true);
  });
});

describe("Control Room insights API", () => {
  it("every route is admin-only", async () => {
    const fan = await signup(app);
    for (const url of ["/admin/control/fans", "/admin/control/revenue", "/admin/control/sponsors", "/admin/control/ops"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url, ...as(fan.cookie) })).statusCode).toBe(403);
    }
  });

  it("fan intelligence: funnel, cohorts, segments, creator dependence, top collectors", async () => {
    const before = await get("/admin/control/fans");
    const { packId } = await makeSetWithPack({ price: 50 });
    const a = await signup(app, "Opener");
    const b = await signup(app, "Lurker");
    const open = await app.inject({ method: "POST", url: `/packs/${packId}/open`, payload: { idempotencyKey: randomUUID() }, ...as(a.cookie) });
    expect(open.statusCode).toBe(200);
    const f = await get("/admin/control/fans");
    // other test files share this DB and sign users up concurrently: assert lower bounds, not exact counts
    expect(f.funnel.signedUp).toBeGreaterThanOrEqual(before.funnel.signedUp + 2);
    expect(f.funnel.openedPack).toBeGreaterThanOrEqual(before.funnel.openedPack + 1);
    const today = f.cohorts.find((c: { ageDays: number }) => c.ageDays === 0);
    expect(today.size).toBeGreaterThanOrEqual(2);
    expect(today.size).toBeLessThanOrEqual(f.funnel.signedUp);
    expect(today.activatedD0).toBeGreaterThanOrEqual(1);
    expect(today.retainedD1).toBeNull(); // not old enough to measure
    expect(f.segments.new).toBeGreaterThanOrEqual(2);
    expect(f.creatorDependence.members.length).toBeGreaterThan(0);
    const shares = f.creatorDependence.members.reduce((t: number, m: { share: number }) => t + m.share, 0);
    expect(shares).toBeLessThanOrEqual(1.0001);
    expect(["high", "moderate", "diversified"]).toContain(f.creatorDependence.risk);
    expect(f.topCollectors.some((t: { score: number }) => t.score > 0)).toBe(true);
    void b;
  });

  it("revenue: economy balances issued − sunk = outstanding", async () => {
    const r = await get("/admin/control/revenue");
    expect(r.purchases.cluster).toBe("devnet");
    expect(r.purchases.testFunds).toBe(true);
    expect(r.economy.outstanding).toBe(r.economy.issued - r.economy.sunk);
    expect(r.economy.issuedBy.signupBonus).toBeGreaterThan(0);
    expect(r.economy.sunk).toBeGreaterThan(0);
    expect(r.solByDay).toHaveLength(14);
  });

  it("sponsors: fit-checked create, activation on a campaign, reach, end, audit", async () => {
    const bad = await app.inject({ method: "POST", url: "/admin/control/sponsors", payload: { name: "BetNow Sportsbook", category: "entertainment" }, ...as(admin.cookie) });
    expect(bad.statusCode).toBe(400);
    const name = `G FUEL ${randomUUID().slice(0, 6)}`;
    const created = await app.inject({ method: "POST", url: "/admin/control/sponsors", payload: { name, category: "energy_drink", notes: "Long-running FaZe partner" }, ...as(admin.cookie) });
    expect(created.statusCode).toBe(201);
    const sponsorId = created.json().id;
    expect((await app.inject({ method: "POST", url: "/admin/control/sponsors", payload: { name, category: "energy_drink" }, ...as(admin.cookie) })).statusCode).toBe(409);

    // a launched campaign to sponsor: campaign row pointing at a live pack with real pulls
    const { packId, setId } = await makeSetWithPack({ price: 40 });
    const camp = await pool.query("INSERT INTO campaigns (name, status, set_id, pack_id, created_by, launched_at) VALUES ('Sponsored drop','live',$1,$2,$3,now()) RETURNING id", [setId, packId, admin.id]);
    const campaignId = camp.rows[0].id;
    for (let i = 0; i < 2; i++) {
      const f = await signup(app);
      await app.inject({ method: "POST", url: `/packs/${packId}/open`, payload: { idempotencyKey: randomUUID() }, ...as(f.cookie) });
    }
    const act = await app.inject({ method: "POST", url: `/admin/control/sponsors/${sponsorId}/activations`, payload: { campaignId, feeUsd: 5000, deliverables: "Logo on pack + 1 tweet" }, ...as(admin.cookie) });
    expect(act.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/admin/control/sponsors/${sponsorId}/activations`, payload: { campaignId }, ...as(admin.cookie) })).statusCode).toBe(409);

    const list = await get("/admin/control/sponsors");
    const sp = list.sponsors.find((x: { id: string }) => x.id === sponsorId);
    expect(sp).toMatchObject({ totalFeeUsd: 5000, collectorsReached: 2, opens: 2 });
    expect(sp.activations[0].costPerCollectorUsd).toBe(2500);

    const rev = await get("/admin/control/revenue");
    expect(rev.campaigns.find((c: { id: string }) => c.id === campaignId).sponsorFeesUsd).toBe(5000);

    expect((await app.inject({ method: "POST", url: `/admin/control/sponsors/activations/${act.json().id}/end`, ...as(admin.cookie) })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/admin/control/sponsors/${sponsorId}`, payload: { status: "paused" }, ...as(admin.cookie) })).statusCode).toBe(200);
    const audit = (await get("/admin/control/audit?limit=20")).entries.map((e: { action: string }) => e.action);
    for (const x of ["sponsor.create", "sponsor.activate", "sponsor.end_activation", "sponsor.pause"]) expect(audit).toContain(x);
  });

  it("ops: health, jobs, moderation queue without image bytes, rights register, migrations", async () => {
    await signup(app, "Needs Review"); // creates a pending display_name submission
    const o = await get("/admin/control/ops");
    expect(o.health.api).toBe("ok");
    expect(o.migrations.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining(["001_init.sql", "003_control_room.sql", "006_sponsors.sql"]));
    const item = o.moderation.find((m: { summary: string }) => m.summary.includes("Needs Review"));
    expect(item).toBeTruthy();
    expect(JSON.stringify(o.moderation)).not.toContain("base64");
    expect(Array.isArray(o.rights)).toBe(true);
  });
});

describe("review fixes (Tush's trading E2E)", () => {
  it("rejects oversized trade offers (max 20 ids per side)", async () => {
    const a = await signup(app), b = await signup(app);
    const ids = Array.from({ length: 21 }, () => randomUUID());
    const r = await app.inject({ method: "POST", url: "/trades", payload: { toUserId: b.id, offeredInstanceIds: ids, requestedInstanceIds: [] }, ...as(a.cookie) });
    expect(r.statusCode).toBe(400);
  });
});
