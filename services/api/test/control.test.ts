// FaZe Control Room (lead, contract v1.6): KAM scoring, Studio drafts, approval gates, launch through
// the real admin API, simulated collectors through the real pack-open path, metrics and audit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeAdmin, makeApp, makeSetWithPack, pool, signup } from "./helpers.js";
import { collectibleFit, daysToAnniversary, scoreMoment, viewsIn } from "../src/control/kam.js";
import { campaignOdds, findDuplicate, similarity, templateDrafts } from "../src/control/studio.js";

let app: FastifyInstance;
let admin: { id: string; cookie: string };
const as = (cookie: string) => ({ headers: { cookie } });

beforeAll(async () => {
  app = await makeApp();
  admin = await makeAdmin();
  await makeSetWithPack(); // gives Studio existing art to reuse + live data for KAM
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("KAM scoring (pure)", () => {
  it("counts days to the next anniversary and the anniversary number", () => {
    const a = daysToAnniversary(new Date("2010-05-31T00:00:00Z"), new Date("2026-05-20T12:00:00Z"));
    expect(a).toMatchObject({ days: 11, years: 16 });
    expect(daysToAnniversary(new Date("2010-05-31T00:00:00Z"), new Date("2026-06-01T00:00:00Z")).years).toBe(17);
  });
  it("reads the archive's own view counts", () => {
    expect(viewsIn("1.40M lifetime views, uploaded")).toBe(1_400_000);
    expect(viewsIn("475,099 lifetime views. The channel")).toBe(475_099);
    expect(viewsIn("No numbers here")).toBe(0);
  });
  it("uses live external views (Moment Scout) instead of archive text when provided", () => {
    const m = { id: "y", occurredOn: "2016-08-06", precision: "day", title: "#TheReturn teamtage", summary: "Curator-written summary with no API stats.", members: [], tags: ["montage"], source: "YouTube https://youtu.be/x", citations: [] };
    const off = scoreMoment(m, new Map(), 0, new Date("2026-11-15T00:00:00Z"));
    const on = scoreMoment(m, new Map(), 0, new Date("2026-11-15T00:00:00Z"), 4_020_000);
    const sig = (r: typeof on) => r.signals.find((s) => s.key === "archive")!;
    expect(sig(on).points).toBeGreaterThan(sig(off).points);
    // API statistics must not persist in stored scan evidence (opportunities.signals): no number in the text
    expect(sig(on).detail).toMatch(/Live YouTube reach/);
    expect(sig(on).detail).not.toMatch(/4\.0M|4,?020,?000|4020/);
  });
  it("score equals the sum of explained signal points, each within its weight", () => {
    const m = { id: "x", occurredOn: "2012-10-12", precision: "day", title: "Introducing FaZe Rain", summary: "490,526 views. Rain becomes one of the most-watched personalities.", members: ["Rain"], tags: ["creator"], source: "FaZe Clan: A Timeline, 2010–2026 (PDF), p.6", citations: [] };
    const stats = new Map([["rain", { cards: 3, hype: 80, pulls7d: 30, owners: 9, eng24: 300, engPrev24: 100 }]]);
    const r = scoreMoment(m, stats, 60, new Date("2026-10-01T00:00:00Z"));
    expect(r.signals).toHaveLength(5);
    for (const s of r.signals) { expect(s.points).toBeGreaterThanOrEqual(0); expect(s.points).toBeLessThanOrEqual(s.weight); expect(s.detail.length).toBeGreaterThan(5); }
    expect(r.score).toBeCloseTo(r.signals.reduce((a, s) => a + s.points, 0), 0);
    expect(r.signals.find((s) => s.key === "anniversary")!.detail).toMatch(/14-year anniversary in 11 days/);
    expect(r.recommendation).toContain("Rain");
  });
});

describe("KAM collectible fit", () => {
  const base = { title: "x", summary: "", tags: [] as string[], members: ["Banks"] };
  it("never recommends legal, gambling, health or harm moments", () => {
    expect(collectibleFit({ ...base, summary: "Tfue sues FaZe Clan over his contract" }).ok).toBe(false);
    expect(collectibleFit({ ...base, summary: "becomes the official sports betting and iGaming partner" }).ok).toBe(false);
    expect(collectibleFit({ ...base, summary: "breaks his silence on depression" }).ok).toBe(false);
    expect(collectibleFit({ ...base, tags: ["controversy"] }).ok).toBe(false);
    expect(collectibleFit({ ...base, members: [], tags: ["business"] }).ok).toBe(false);
    expect(collectibleFit({ ...base, summary: "The 1 Million Subscribers Teamtage" }).ok).toBe(true);
  });
});

describe("Moment Studio (pure)", () => {
  const moment = { title: "Introducing FaZe Temperrr", summary: "1.62M views on the intro video. Thomas “Temperrr” Oliveira joins at sixteen, brings the graphic-design skills that produce the logo. His concept invents the reversed F.", members: ["Temperrr"], occurredOn: "2010-08-03", source: "FaZe Clan: A Timeline, 2010–2026 (PDF), p.1" };
  it("drafts 5 cards across every rarity, with lore taken only from the archive text", () => {
    const d = templateDrafts(moment, () => "/demo-art/x.svg");
    expect(d.map((x) => x.rarity)).toEqual(["common", "common", "rare", "epic", "legendary"]);
    for (const x of d) {
      expect(x.fazeMember).toBe("FaZe Temperrr");
      const text = x.lore.replace(/\s*\(2010 · .*\)$/, "").replace(/…$/, "");
      // either one of the archive's own sentences, or a plain caption naming the moment (no invented facts)
      const fromArchive = moment.summary.includes(text.slice(0, 30));
      const caption = /^(Origin|Crowd|Highlight|Signature|Legend) card from “Introducing FaZe Temperrr”, 2010\.$/.test(text);
      expect(fromArchive || caption).toBe(true);
    }
    expect(d[4].maxSupply).toBe(50);
    expect(new Set(d.map((x) => x.lore)).size).toBe(5); // no repeated lore
  });
  it("names org-wide moments cleanly", () => {
    const d = templateDrafts({ ...moment, members: [] }, () => "");
    expect(d[0].name.startsWith("Introducing")).toBe(true);
    expect(d[0].fazeMember).toBe("FaZe Clan");
  });
  it("flags near-duplicate card names, not unrelated ones", () => {
    expect(similarity("Banks / OG Era 1", "Banks / OG Era 1")).toBe(1);
    const existing = [{ id: "a", name: "Temperrr / Introducing FaZe · Origin", fazeMember: "FaZe Temperrr" }];
    expect(findDuplicate("Temperrr / Introducing FaZe · Origin", "FaZe Temperrr", existing)?.id).toBe("a");
    expect(findDuplicate("Rain / 1 Million Subscribers", "FaZe Rain", existing)).toBeNull();
  });
  it("pack odds cover only rarities in the drop and sum to 100", () => {
    for (const r of [["common", "rare", "epic", "legendary"], ["common", "legendary"], ["rare"]] as const) {
      const o = campaignOdds([...r]);
      expect(Object.keys(o).sort()).toEqual([...r].sort());
      expect(Object.values(o).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
});

describe("Control Room API", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/control/overview" })).statusCode).toBe(401);
    const fan = await signup(app);
    expect((await app.inject({ method: "POST", url: "/admin/control/kam/scan", ...as(fan.cookie) })).statusCode).toBe(403);
  });

  it("archive search finds moments by full text and member", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/control/archive?q=trickshot&limit=5", ...as(admin.cookie) });
    expect(r.statusCode).toBe(200);
    expect(r.json().moments.length).toBeGreaterThan(0);
    const m = await app.inject({ method: "GET", url: "/admin/control/archive?member=Banks&limit=5", ...as(admin.cookie) });
    for (const x of m.json().moments) expect(x.members).toContain("Banks");
  });

  it("full flow: scan → draft → approval gates → launch via admin API → simulated collectors → metrics → end → audit", async () => {
    const scan = await app.inject({ method: "POST", url: "/admin/control/kam/scan", ...as(admin.cookie) });
    expect(scan.statusCode).toBe(200);
    const { opportunities, scanned } = scan.json();
    expect(scanned).toBeGreaterThan(300);
    expect(opportunities.length).toBeGreaterThan(0);
    for (let i = 1; i < opportunities.length; i++) expect(opportunities[i - 1].score).toBeGreaterThanOrEqual(opportunities[i].score);
    const top = opportunities[0];
    expect(top.signals).toHaveLength(5);
    expect(top.moment.source).toMatch(/PDF\), p\.\d+/);

    const created = await app.inject({ method: "POST", url: "/admin/control/campaigns", payload: { opportunityId: top.id }, ...as(admin.cookie) });
    expect(created.statusCode).toBe(201);
    const { campaign, assets } = created.json();
    expect(campaign.status).toBe("draft");
    expect(assets).toHaveLength(5);
    // the same opportunity can't spawn a second campaign
    expect((await app.inject({ method: "POST", url: "/admin/control/campaigns", payload: { opportunityId: top.id }, ...as(admin.cookie) })).statusCode).toBe(409);

    // edit a draft card, then submit
    const edited = await app.inject({ method: "PATCH", url: `/admin/control/campaigns/${campaign.id}/assets/${assets[0].id}`, payload: { name: "Edited / Moment Card" }, ...as(admin.cookie) });
    expect(edited.json().assets[0].name).toBe("Edited / Moment Card");
    // can't launch before approval
    expect((await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/launch`, ...as(admin.cookie) })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/submit`, ...as(admin.cookie) })).json().campaign.status).toBe("pending_approval");
    // approval requires rights confirmation
    const noRights = await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/review`, payload: { decision: "approve" }, ...as(admin.cookie) });
    expect(noRights.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/review`, payload: { decision: "approve", rightsConfirmed: true, rightsNote: "Archive moment + original seed art" }, ...as(admin.cookie) });
    expect(ok.json().campaign.status).toBe("approved");

    const launched = await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/launch`, payload: { packPriceCoins: 120 }, ...as(admin.cookie) });
    expect(launched.statusCode).toBe(200);
    const live = launched.json();
    expect(live.campaign.status).toBe("live");
    expect(live.assets.every((a: { cardId: string | null }) => a.cardId)).toBe(true);
    const set = await pool.query("SELECT status FROM card_sets WHERE id=$1", [live.campaign.setId]);
    expect(set.rows[0].status).toBe("live");
    // a fan can see and open the new pack in the store
    const fan = await signup(app);
    const packs = (await app.inject({ method: "GET", url: "/packs", ...as(fan.cookie) })).json().packs;
    expect(packs.map((p: { id: string }) => p.id)).toContain(live.campaign.packId);
    // double launch is refused
    expect((await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/launch`, ...as(admin.cookie) })).statusCode).toBe(409);

    const sim = await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/simulate`, payload: { collectors: 3 }, ...as(admin.cookie) });
    expect(sim.json()).toMatchObject({ collectors: 3, demo: true });
    expect(sim.json().packsOpened).toBe(6); // 1 + 2 + 3 packs

    const metrics = (await app.inject({ method: "GET", url: `/admin/control/campaigns/${campaign.id}/metrics`, ...as(admin.cookie) })).json();
    expect(metrics).toMatchObject({ launched: true, pulls: 6, collectors: 3, demoCollectors: 3, coinsSpent: 720, cardsMinted: 30 });
    expect(metrics.pullsByMinute.length).toBeGreaterThanOrEqual(2); // zero-filled from launch
    expect(metrics.pullsByMinute.reduce((a: number, p: { n: number }) => a + p.n, 0)).toBe(6);

    const ended = await app.inject({ method: "POST", url: `/admin/control/campaigns/${campaign.id}/end`, ...as(admin.cookie) });
    expect(ended.json().campaign.status).toBe("ended");
    expect((await pool.query("SELECT active FROM packs WHERE id=$1", [live.campaign.packId])).rows[0].active).toBe(false);

    const audit = (await app.inject({ method: "GET", url: "/admin/control/audit?limit=50", ...as(admin.cookie) })).json().entries.map((e: { action: string }) => e.action);
    for (const a of ["kam.scan", "campaign.create", "asset.edit", "campaign.submit", "campaign.approve", "campaign.launch", "campaign.simulate", "campaign.end"]) expect(audit).toContain(a);

    const overview = (await app.inject({ method: "GET", url: "/admin/control/overview", ...as(admin.cookie) })).json();
    expect(overview.kpis.packsOpened).toBeGreaterThanOrEqual(6);
    expect(overview.series.pullsByHour).toHaveLength(24);
    expect(overview.health.api).toBe("ok");
  });
});
