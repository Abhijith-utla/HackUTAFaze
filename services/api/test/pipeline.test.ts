// Clip / frame → face → composed card art pipeline (v1.9 draft). Admin-only, rights-gated,
// detection-only (no landmarks persisted), output lands on a Studio draft — never on live cards.
// Fixture: test/fixtures/face-portrait.jpg is a downscaled NASA portrait (public domain).
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeAdmin, makeApp, pool, signup } from "./helpers.js";
import { analyzeStill } from "../src/pipeline/analyze.js";
import { CARD_H, CARD_W, cardOverlaySvg, composeCard, escapeXml } from "../src/pipeline/compose.js";
import { loadFfmpeg, loadOrt, loadSharp } from "../src/pipeline/deps.js";
import { setDetector } from "../src/pipeline/detect.js";
import { runProcess } from "../src/pipeline/frames.js";
import { setVideoAnalyzer } from "../src/pipeline/runner.js";
import { clampBox, headShoulderBox, outputSize, pickTop, type Face } from "../src/pipeline/score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "face-portrait.jpg");
const ok = <T>(p: Promise<T>) => p.then(() => true, () => false);
const hasSharp = await ok(loadSharp());
const hasOrt = await ok(loadOrt());
const hasFfmpeg = await ok(loadFfmpeg());

let app: FastifyInstance;
let admin: { id: string; cookie: string };
let fixture: Buffer;
const as = (cookie: string) => ({ headers: { cookie } });
const label = () => `FaZe official clip test ${randomUUID().slice(0, 8)}`;
const rights = { rightsConfirmed: true, rightsNote: "Official FaZe Twitch VOD; FaZe media team approved (test)" };

/** Deterministic stand-in for YuNet: one face in the upper middle, WITH landmarks (to prove they are dropped). */
const fakeDetector = async (image: Buffer) => {
  const sharp = await loadSharp();
  const m = await sharp(image).metadata();
  const W = m.width as number, H = m.height as number;
  const w = W * 0.25, h = H * 0.3, x = W * 0.45, y = H * 0.12;
  const lm: [number, number][] = [[x + w * 0.3, y + h * 0.4], [x + w * 0.7, y + h * 0.4], [x + w * 0.5, y + h * 0.6], [x + w * 0.35, y + h * 0.8], [x + w * 0.65, y + h * 0.8]];
  return { width: W, height: H, faces: [{ x, y, w, h, score: 0.91, lm }] as Face[] };
};

const frameBody = (extra: Record<string, unknown> = {}) => ({
  imageBase64: fixture.toString("base64"),
  mimeType: "image/jpeg",
  sourceUrl: "https://www.twitch.tv/faze/clip/ExampleOfficialClip",
  sourceLabel: label(),
  timestampMs: 83_450,
  ...rights,
  ...extra,
});

beforeAll(async () => {
  app = await makeApp();
  admin = await makeAdmin();
  fixture = await readFile(FIXTURE);
});
afterAll(async () => {
  setDetector(null);
  setVideoAnalyzer(null);
  await app.close();
  await pool.end();
});

describe("geometry + composer (pure / sharp)", () => {
  it("clampBox forces 5:6 inside the frame", () => {
    for (const b of [{ x: -50, y: -80, w: 900, h: 100 }, { x: 400, y: 500, w: 30, h: 30 }, { x: 10, y: 10, w: 200, h: 240 }]) {
      const c = clampBox(b, 480, 600);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(480);
      expect(c.y + c.h).toBeLessThanOrEqual(600);
      expect(Math.abs(c.w / c.h - 5 / 6)).toBeLessThan(0.01);
    }
  });
  it("head-and-shoulders crop and output size flags low-res sources", () => {
    const face: Face = { x: 600, y: 200, w: 120, h: 150, score: 0.9, lm: [[630, 260], [690, 260], [660, 290], [640, 320], [680, 320]] };
    const b = headShoulderBox(face, 1280, 720);
    expect(b.y).toBeLessThan(200);
    expect(outputSize(b.h)).toMatchObject({ lowRes: true, height: Math.min(1200, Math.max(600, Math.round(b.h * 1.5))) });
    expect(outputSize(800)).toEqual({ width: 1000, height: 1200, lowRes: false });
  });
  it("pickTop keeps candidates ≥ 1 s apart", () => {
    const s = (t: number) => ({ confidence: 0, size: 0, sharpness: 0, frontal: 0, exposure: 0, total: t });
    const top = pickTop([{ frameNo: 0, frameMs: 0, scores: s(0.9) }, { frameNo: 1, frameMs: 500, scores: s(0.8) }, { frameNo: 2, frameMs: 1000, scores: s(0.7) }]);
    expect(top.map((t) => t.frameMs)).toEqual([0, 1000]);
  });
  it("escapes XML in card text", () => {
    expect(escapeXml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&apos;");
    const svg = cardOverlaySvg({ name: "</text><script>x</script>", member: "FaZe A&B", rarity: "epic" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("#A35CFF");
    expect(svg).toContain("#E4002B");
  });
  it.skipIf(!hasSharp)("composes a 1000×1200 WebP card", async () => {
    const sharp = await loadSharp();
    const card = await composeCard(fixture, { name: "Test / Clip Card", member: "FaZe Test", rarity: "legendary", setLabel: "Clip Lab" });
    const m = await sharp(card).metadata();
    expect(m).toMatchObject({ format: "webp", width: CARD_W, height: CARD_H });
    expect(card.length).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("pipeline API gates", () => {
  it("is admin-only", async () => {
    const id = randomUUID();
    for (const [method, url] of [["POST", "/admin/pipeline/face-art"], ["POST", "/admin/pipeline/face-frame"], ["GET", `/admin/pipeline/jobs/${id}`], ["GET", `/admin/pipeline/jobs/${id}/candidates/1.webp`], ["POST", `/admin/pipeline/jobs/${id}/pick`]] as const)
      expect((await app.inject({ method, url, payload: method === "POST" ? {} : undefined })).statusCode).toBe(401);
    const fan = await signup(app);
    expect((await app.inject({ method: "POST", url: "/admin/pipeline/face-frame", payload: frameBody(), ...as(fan.cookie) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/admin/pipeline/jobs/${id}`, ...as(fan.cookie) })).statusCode).toBe(403);
  });

  it("refuses without rights confirmation + note (frame and clip)", async () => {
    const before = Number((await pool.query("SELECT count(*) FROM pipeline_jobs")).rows[0].count);
    for (const extra of [{ rightsConfirmed: false }, { rightsNote: "" }, { rightsNote: undefined, rightsConfirmed: true }, { rightsConfirmed: "true" }]) {
      const r = await app.inject({ method: "POST", url: "/admin/pipeline/face-frame", payload: frameBody(extra), ...as(admin.cookie) });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.message).toMatch(/rights/i);
    }
    const clip = await app.inject({ method: "POST", url: "/admin/pipeline/face-art", payload: { base64: "AAAA", mimeType: "video/mp4", sourceLabel: label(), rightsConfirmed: false, rightsNote: "x" }, ...as(admin.cookie) });
    expect(clip.statusCode).toBe(400);
    expect(Number((await pool.query("SELECT count(*) FROM pipeline_jobs")).rows[0].count)).toBe(before);
  });

  it.skipIf(!hasSharp)("rejects a non-MP4 clip and mismatched frame types", async () => {
    setVideoAnalyzer(async () => { throw new Error("unused"); });
    setDetector(fakeDetector);
    try {
      const notMp4 = await app.inject({ method: "POST", url: "/admin/pipeline/face-art", payload: { base64: fixture.toString("base64"), mimeType: "video/mp4", sourceLabel: label(), ...rights }, ...as(admin.cookie) });
      expect(notMp4.statusCode).toBe(400);
      expect(notMp4.json().error.message).toMatch(/MP4/);
      const png = await app.inject({ method: "POST", url: "/admin/pipeline/face-frame", payload: frameBody({ mimeType: "image/png" }), ...as(admin.cookie) });
      expect(png.statusCode).toBe(400);
    } finally {
      setVideoAnalyzer(null);
      setDetector(null);
    }
  });
});

describe.skipIf(!hasSharp)("still frame → candidates → pick → Studio draft", () => {
  let jobId: string;
  let sourceLabel: string;

  it("detects + scores a frame synchronously, keeps no landmarks", async () => {
    setDetector(fakeDetector);
    const body = frameBody();
    sourceLabel = body.sourceLabel;
    const r = await app.inject({ method: "POST", url: "/admin/pipeline/face-frame", payload: body, ...as(admin.cookie) });
    setDetector(null);
    expect(r.statusCode).toBe(201);
    const out = r.json();
    jobId = out.jobId;
    expect(out.frame).toMatchObject({ width: 480, height: 600 });
    expect(out.source).toMatchObject({ label: sourceLabel, url: body.sourceUrl, frameMs: 83_450 });
    expect(out.candidates).toHaveLength(1);
    const c = out.candidates[0];
    expect(Object.keys(c.scores).sort()).toEqual(["confidence", "exposure", "frontal", "sharpness", "size", "total"]);
    expect(Math.abs(c.box.w / c.box.h - 5 / 6)).toBeLessThan(0.01);
    expect(c.previewUrl).toBe(`/admin/pipeline/jobs/${jobId}/candidates/1.webp`);
    expect(JSON.stringify(out)).not.toMatch(/"lm"|landmark|kps/i);

    // nothing landmark-like persisted anywhere for this job
    const rows = await pool.query("SELECT j.stats, c.scores, c.crop_box FROM pipeline_jobs j JOIN pipeline_candidates c ON c.job_id = j.id WHERE j.id=$1", [jobId]);
    expect(JSON.stringify(rows.rows)).not.toMatch(/"lm"|landmark|kps|eye|nose|mouth/i);
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name IN ('pipeline_jobs','pipeline_candidates','pipeline_frames','campaign_asset_art_sources')")).rows.map((x) => x.column_name);
    expect(cols.filter((c) => /landmark|embedding|lm|kps/.test(c))).toEqual([]);

    const audit = await pool.query("SELECT detail FROM audit_log WHERE action='pipeline.create' AND entity_id=$1", [jobId]);
    expect(audit.rows[0].detail).toMatchObject({ kind: "face_frame", sourceUrl: body.sourceUrl, rightsNote: rights.rightsNote });
  });

  it("serves previews and frames to admins only, privately", async () => {
    const r = await app.inject({ method: "GET", url: `/admin/pipeline/jobs/${jobId}/candidates/1.webp`, ...as(admin.cookie) });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/webp");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ method: "GET", url: `/admin/pipeline/jobs/${jobId}/frames/0.jpg`, ...as(admin.cookie) })).headers["content-type"]).toBe("image/jpeg");
    const fan = await signup(app);
    expect((await app.inject({ method: "GET", url: `/admin/pipeline/jobs/${jobId}/candidates/1.webp`, ...as(fan.cookie) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/admin/pipeline/jobs/${jobId}/frames/0.jpg`, ...as(fan.cookie) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/admin/pipeline/jobs/${jobId}/candidates/1.webp` })).statusCode).toBe(401);
    // candidates are not in card_art, so /art can never serve them
    expect(Number((await pool.query("SELECT count(*) FROM card_art a JOIN pipeline_candidates c ON c.bytes = a.bytes WHERE c.job_id=$1", [jobId])).rows[0].count)).toBe(0);
  });

  it("pick by rank composes card art, creates a draft (never a live card) with source + timestamp", async () => {
    const r = await app.inject({ method: "POST", url: `/admin/pipeline/jobs/${jobId}/pick`, payload: { rank: 1, cardName: "Clip Test / Clutch", fazeMember: "FaZe Tester", rarity: "epic", setLabel: "Clip Lab" }, ...as(admin.cookie) });
    expect(r.statusCode).toBe(200);
    const out = r.json();
    expect(out.artUrl).toMatch(/^\/art\/[0-9a-f-]{36}\.webp$/);
    expect(out.draft).toMatchObject({ created: true, status: "draft", link: `/admin/control/campaigns/${out.draft.campaignId}` });
    expect(out.artSource).toMatchObject({ jobId, rank: 1, frameMs: 83_450, sourceLabel, sourceUrl: "https://www.twitch.tv/faze/clip/ExampleOfficialClip" });
    expect(out.card).toMatchObject({ width: 1000, height: 1200, mime: "image/webp" });

    const art = await app.inject({ method: "GET", url: out.artUrl });
    expect(art.statusCode).toBe(200);
    const m = await (await loadSharp())(art.rawPayload).metadata();
    expect(m).toMatchObject({ format: "webp", width: 1000, height: 1200 });
    expect(Number((await pool.query("SELECT count(*) FROM cards WHERE art_url=$1", [out.artUrl])).rows[0].count)).toBe(0);

    const camp = (await app.inject({ method: "GET", url: `/admin/control/campaigns/${out.draft.campaignId}`, ...as(admin.cookie) })).json();
    expect(camp.campaign).toMatchObject({ status: "draft", rightsConfirmed: false, generator: "clip_lab" });
    expect(camp.assets).toHaveLength(1);
    expect(camp.assets[0]).toMatchObject({ artUrl: out.artUrl, name: "Clip Test / Clutch", rarity: "epic", maxSupply: 250, cardId: null });
    expect(camp.assets[0].artSource).toMatchObject({ jobId, frameMs: 83_450, sourceLabel, current: true });
    // still gated: no launch before submit + review with rights
    expect((await app.inject({ method: "POST", url: `/admin/control/campaigns/${out.draft.campaignId}/launch`, ...as(admin.cookie) })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/admin/control/campaigns/${out.draft.campaignId}/regenerate`, ...as(admin.cookie) })).statusCode).toBe(409);
    const audit = await pool.query("SELECT detail FROM audit_log WHERE action='pipeline.pick' AND entity_id=$1", [jobId]);
    expect(audit.rows[0].detail).toMatchObject({ rank: 1, customBox: false, campaignId: out.draft.campaignId, sourceLabel });
  });

  it("pick with a custom box clamps to 5:6 and replaces an existing draft asset's art", async () => {
    const c = await pool.query("INSERT INTO campaigns (name, created_by) VALUES ('Pipeline test drop', $1) RETURNING id", [admin.id]);
    const campaignId = c.rows[0].id as string;
    const a = await pool.query("INSERT INTO campaign_assets (campaign_id, position, name, faze_member, rarity, lore, art_url) VALUES ($1,0,'Old','FaZe Old','common','Archive lore','/demo-art/x.svg') RETURNING id", [campaignId]);
    const assetId = a.rows[0].id as string;
    const r = await app.inject({
      method: "POST", url: `/admin/pipeline/jobs/${jobId}/pick`,
      payload: { box: { x: -40, y: 20, w: 400, h: 100 }, cardName: "Custom / Box", fazeMember: "FaZe Box", rarity: "rare", campaignId, assetId },
      ...as(admin.cookie),
    });
    expect(r.statusCode).toBe(200);
    const out = r.json();
    const b = out.artSource.box;
    expect(out.artSource.rank).toBeNull();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(480);
    expect(b.y + b.h).toBeLessThanOrEqual(600);
    expect(Math.abs(b.w / b.h - 5 / 6)).toBeLessThan(0.01);
    expect(out.draft).toMatchObject({ campaignId, assetId, created: false });
    const row = (await pool.query("SELECT name, rarity, art_url, lore, base_power FROM campaign_assets WHERE id=$1", [assetId])).rows[0];
    expect(row).toMatchObject({ name: "Custom / Box", rarity: "rare", art_url: out.artUrl, lore: "Archive lore", base_power: 38 });

    // not editable once submitted
    await pool.query("UPDATE campaigns SET status='pending_approval' WHERE id=$1", [campaignId]);
    const locked = await app.inject({ method: "POST", url: `/admin/pipeline/jobs/${jobId}/pick`, payload: { rank: 1, cardName: "X", fazeMember: "FaZe X", rarity: "common", campaignId, assetId }, ...as(admin.cookie) });
    expect(locked.statusCode).toBe(409);
  });

  it("validates pick bodies", async () => {
    const bad = [{ cardName: "X", fazeMember: "Y", rarity: "rare" }, { rank: 1, cardName: "X", fazeMember: "Y", rarity: "mythic" }, { rank: 1, cardName: "X", fazeMember: "Y", rarity: "rare", assetId: randomUUID() }];
    for (const p of bad) expect((await app.inject({ method: "POST", url: `/admin/pipeline/jobs/${jobId}/pick`, payload: p, ...as(admin.cookie) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/admin/pipeline/jobs/${randomUUID()}/pick`, payload: { rank: 1, cardName: "X", fazeMember: "Y", rarity: "rare" }, ...as(admin.cookie) })).statusCode).toBe(404);
  });
});

describe.skipIf(!hasSharp)("MP4 job lifecycle", () => {
  const poll = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      const j = (await app.inject({ method: "GET", url: `/admin/pipeline/jobs/${id}`, ...as(admin.cookie) })).json();
      if (["done", "failed"].includes(j.job.status)) return j;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("job did not finish");
  };

  it("queued → running → done with candidates; then pick", async () => {
    let mp4: Buffer;
    let dir: string | null = null;
    if (hasFfmpeg) {
      // Tiny real MP4 generated from the still: 3 s, 480×600.
      dir = await mkdtemp(path.join(tmpdir(), "faze-pipe-test-"));
      const file = path.join(dir, "clip.mp4");
      await runProcess(await loadFfmpeg(), ["-hide_banner", "-loglevel", "error", "-loop", "1", "-i", FIXTURE, "-t", "3", "-r", "10", "-vf", "format=yuv420p", "-movflags", "+faststart", "-y", file]);
      mp4 = await readFile(file);
      if (!hasOrt) setDetector(fakeDetector); // real YuNet when installed
    } else {
      // No ffmpeg here: fake MP4 bytes + an analyzer that treats the still as the clip's frames.
      mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
      setDetector(fakeDetector);
      setVideoAnalyzer(async () => {
        const a = await analyzeStill(fixture, 500);
        return a;
      });
    }
    try {
      const body = { base64: mp4.toString("base64"), mimeType: "video/mp4", sourceLabel: label(), sourceUrl: "https://www.youtube.com/watch?v=official", ...rights };
      const r = await app.inject({ method: "POST", url: "/admin/pipeline/face-art", payload: body, ...as(admin.cookie) });
      expect(r.statusCode).toBe(202);
      const { jobId } = r.json();
      const j = await poll(jobId);
      expect(j.job.error).toBeNull();
      expect(j.job).toMatchObject({ kind: "face_art", status: "done", source: { label: body.sourceLabel, url: body.sourceUrl } });
      expect(j.candidates.length).toBeGreaterThanOrEqual(1);
      for (const c of j.candidates) {
        expect(c.frameMs).toBeGreaterThanOrEqual(0);
        expect(c.scores.total).toBeGreaterThan(0);
        expect(c).not.toHaveProperty("lm");
      }
      if (hasFfmpeg) {
        expect(j.job.stats.frames).toBeGreaterThanOrEqual(5); // ~2 fps over 3 s
        expect(j.candidates.every((c: { frameMs: number }) => c.frameMs % 500 === 0)).toBe(true);
      }
      const pick = await app.inject({ method: "POST", url: `/admin/pipeline/jobs/${jobId}/pick`, payload: { rank: 1, cardName: "Clip / MP4 Pick", fazeMember: "FaZe Tester", rarity: "legendary" }, ...as(admin.cookie) });
      expect(pick.statusCode).toBe(200);
      expect(pick.json().artSource).toMatchObject({ frameMs: j.candidates[0].frameMs, sourceUrl: body.sourceUrl });
      expect((await pool.query("SELECT count(*) FROM audit_log WHERE entity_id=$1 AND action IN ('pipeline.create','pipeline.pick')", [jobId])).rows[0].count).toBe("2");
    } finally {
      setDetector(null);
      setVideoAnalyzer(null);
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
