// Clip / frame → best face → composed card art (A, lead-approved; contract v1.9 draft).
// Lead conditions: admin-only + audit_log; official FaZe sources with rightsConfirmed + rightsNote;
// face DETECTION + quality scoring only (no recognition, no embeddings, no landmarks stored);
// local only (no third-party APIs, nothing fetched — sourceUrl is metadata); output only reaches
// cards through a Moment Studio draft and its existing review/rights gate.
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { storeArt } from "../art-store.js";
import { requireAdmin } from "../auth.js";
import { pool, tx, type Db } from "../db.js";
import { fail } from "../errors.js";
import { analyzeStill, cropWebp } from "../pipeline/analyze.js";
import { composeCard } from "../pipeline/compose.js";
import { loadFfmpeg, loadOrt, loadSharp, PipelineUnavailable } from "../pipeline/deps.js";
import { detectorOverridden } from "../pipeline/detect.js";
import { attachToDraft, type ArtSource } from "../pipeline/draft.js";
import { assertQueueRoom, enqueueVideoJob, saveAnalysis, videoAnalyzerOverridden } from "../pipeline/runner.js";
import { clampBox, outputSize, type Box } from "../pipeline/score.js";

export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const b64Len = (n: number) => 4 * Math.ceil(n / 3);

const Id = z.object({ id: z.string().uuid() });
const Rights = {
  sourceLabel: z.string().trim().min(1).max(120),
  rightsConfirmed: z.boolean(),
  rightsNote: z.string().max(500).default(""),
};
const Url = z.string().trim().max(500).url().refine((u) => /^https?:\/\//i.test(u), "must be http(s)");
const VideoBody = z.object({ base64: z.string().max(b64Len(MAX_VIDEO_BYTES)), mimeType: z.literal("video/mp4"), sourceUrl: Url.optional(), ...Rights }).strict();
const FrameBody = z
  .object({
    imageBase64: z.string().max(b64Len(MAX_FRAME_BYTES)),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    sourceUrl: Url,
    timestampMs: z.number().int().min(0).max(48 * 3600 * 1000).optional(),
    timestampIso: z.string().datetime({ offset: true }).optional(),
    ...Rights,
  })
  .strict();
const BoxZ = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite().positive(), h: z.number().finite().positive() }).strict();
const PickBody = z
  .object({
    rank: z.number().int().min(1).max(3).optional(),
    box: BoxZ.optional(),
    frameNo: z.number().int().min(0).optional(),
    cardName: z.string().trim().min(1).max(80),
    fazeMember: z.string().trim().min(1).max(60),
    rarity: z.enum(["common", "rare", "epic", "legendary"]),
    setLabel: z.string().trim().min(1).max(40).optional(),
    campaignId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
  })
  .strict()
  .refine((b) => b.rank !== undefined || b.box !== undefined, { message: "Pick a candidate rank or draw a box" })
  .refine((b) => !b.assetId || b.campaignId, { message: "assetId needs its campaignId" });

/** Lead condition 1: official FaZe sources only, same rights confirmation as Moment Studio. */
function requireRights(b: { rightsConfirmed: boolean; rightsNote: string }) {
  if (b.rightsConfirmed !== true || b.rightsNote.trim().length < 3)
    fail("VALIDATION", "Official FaZe clips only: confirm rights/licensing (rightsConfirmed) and add a rights note");
}

function decodeBase64(s: string, max: number, what: string): Buffer {
  if (!s.length || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) fail("VALIDATION", `Invalid base64 ${what}`);
  const bytes = Buffer.from(s, "base64");
  if (!bytes.length || bytes.length > max || bytes.toString("base64") !== s) fail("VALIDATION", `${what} must be canonical base64, at most ${Math.round(max / 1048576)} MB`);
  return bytes;
}

function sniffImage(b: Buffer): string | null {
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 16 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
const isMp4 = (b: Buffer) => b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp";

/** 503 PIPELINE_UNAVAILABLE when an optional dependency is missing (not a shared ErrorCode yet). */
async function needDeps(reply: FastifyReply, kinds: ("sharp" | "detector" | "ffmpeg")[]): Promise<boolean> {
  try {
    for (const k of kinds) {
      if (k === "sharp") await loadSharp();
      if (k === "detector" && !detectorOverridden()) await loadOrt();
      if (k === "ffmpeg" && !videoAnalyzerOverridden()) await loadFfmpeg();
    }
    return true;
  } catch (e) {
    if (!(e instanceof PipelineUnavailable)) throw e;
    reply.code(503).send({ error: { code: "PIPELINE_UNAVAILABLE", message: e.message } });
    return false;
  }
}

async function audit(db: Db, actor: string, action: string, entityId: string, detail: object) {
  await db.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1,$2,'pipeline_job',$3,$4)", [actor, action, entityId, JSON.stringify(detail)]);
}

const previewUrl = (jobId: string, rank: number) => `/admin/pipeline/jobs/${jobId}/candidates/${rank}.webp`;
const toJob = (r: any) => ({
  id: r.id, kind: r.kind, status: r.status,
  source: { label: r.source_label, url: r.source_url, frameMs: r.source_frame_ms, frameAt: r.source_frame_at, sha256: r.source_sha256, bytes: r.source_bytes },
  rightsConfirmed: r.rights_confirmed, rightsNote: r.rights_note,
  stats: r.stats, error: r.error, createdBy: r.created_by,
  createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, updatedAt: r.updated_at,
});
const toCandidate = (jobId: string, r: any) => ({
  rank: r.rank, frameNo: r.frame_no, frameMs: r.frame_ms, scores: r.scores, box: r.crop_box,
  width: r.width, height: r.height, lowRes: r.low_res, bytes: r.size, previewUrl: previewUrl(jobId, r.rank),
});

async function loadJob(id: string) {
  const j = await pool.query("SELECT * FROM pipeline_jobs WHERE id=$1", [id]);
  if (!j.rowCount) fail("NOT_FOUND", "Pipeline job not found");
  const frames = await pool.query("SELECT frame_no, frame_ms, width, height FROM pipeline_frames WHERE job_id=$1 ORDER BY frame_no", [id]);
  const cands = await pool.query("SELECT rank, frame_no, frame_ms, scores, crop_box, width, height, low_res, octet_length(bytes) AS size FROM pipeline_candidates WHERE job_id=$1 ORDER BY rank", [id]);
  return {
    job: toJob(j.rows[0]),
    frames: frames.rows.map((f) => ({ frameNo: f.frame_no, frameMs: f.frame_ms, width: f.width, height: f.height, url: `/admin/pipeline/jobs/${id}/frames/${f.frame_no}.jpg` })),
    candidates: cands.rows.map((r) => toCandidate(id, r)),
  };
}

const privateImage = (reply: FastifyReply, mime: string, bytes: Buffer) =>
  reply.type(mime).header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store").header("Content-Security-Policy", "default-src 'none'; sandbox").send(bytes);

export async function pipelineRoutes(app: FastifyInstance) {
  // ---------- MP4 clip → async job ----------
  app.post("/admin/pipeline/face-art", { bodyLimit: b64Len(MAX_VIDEO_BYTES) + 8192 }, async (req, reply) => {
    const s = requireAdmin(req);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    requireRights({ rightsConfirmed: raw.rightsConfirmed as boolean, rightsNote: typeof raw.rightsNote === "string" ? raw.rightsNote : "" });
    const b = VideoBody.parse(req.body);
    if (!(await needDeps(reply, ["sharp", "detector", "ffmpeg"]))) return reply;
    const bytes = decodeBase64(b.base64, MAX_VIDEO_BYTES, "video");
    if (!isMp4(bytes)) fail("VALIDATION", "Upload must be an MP4 file");
    assertQueueRoom();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = await tx(async (c) => {
      const r = await c.query(
        "INSERT INTO pipeline_jobs (kind, source_label, source_url, source_sha256, source_bytes, rights_confirmed, rights_note, created_by) VALUES ('face_art',$1,$2,$3,$4,true,$5,$6) RETURNING id",
        [b.sourceLabel, b.sourceUrl ?? null, sha256, bytes.length, b.rightsNote.trim(), s.sub],
      );
      await audit(c, s.sub, "pipeline.create", r.rows[0].id, { kind: "face_art", sourceLabel: b.sourceLabel, sourceUrl: b.sourceUrl ?? null, rightsNote: b.rightsNote.trim(), sha256, bytes: bytes.length, processing: "face detection + quality scoring only; no recognition" });
      return r.rows[0].id as string;
    });
    enqueueVideoJob(id, bytes);
    return reply.code(202).send({ jobId: id, status: "queued" });
  });

  // ---------- single still frame (Clip Lab tab capture) → synchronous ----------
  app.post("/admin/pipeline/face-frame", { bodyLimit: b64Len(MAX_FRAME_BYTES) + 8192 }, async (req, reply) => {
    const s = requireAdmin(req);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    requireRights({ rightsConfirmed: raw.rightsConfirmed as boolean, rightsNote: typeof raw.rightsNote === "string" ? raw.rightsNote : "" });
    const b = FrameBody.parse(req.body);
    if (!(await needDeps(reply, ["sharp", "detector"]))) return reply;
    const bytes = decodeBase64(b.imageBase64, MAX_FRAME_BYTES, "image");
    if (sniffImage(bytes) !== b.mimeType) fail("VALIDATION", "Image content does not match mimeType (PNG, JPEG or WebP)");
    let analysis;
    try {
      analysis = await analyzeStill(bytes, b.timestampMs ?? null);
    } catch (e) {
      if (e instanceof PipelineUnavailable) throw e;
      return fail("VALIDATION", `Could not analyse frame: ${(e as Error).message}`.slice(0, 300));
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const frameAt = b.timestampIso ? new Date(b.timestampIso).toISOString() : null;
    const id = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO pipeline_jobs (kind, status, source_label, source_url, source_frame_ms, source_frame_at, source_sha256, source_bytes, rights_confirmed, rights_note, created_by, started_at)
         VALUES ('face_frame','running',$1,$2,$3,$4,$5,$6,true,$7,$8,now()) RETURNING id`,
        [b.sourceLabel, b.sourceUrl, b.timestampMs ?? null, frameAt, sha256, bytes.length, b.rightsNote.trim(), s.sub],
      );
      const jobId = r.rows[0].id as string;
      await saveAnalysis(c, jobId, analysis);
      await audit(c, s.sub, "pipeline.create", jobId, { kind: "face_frame", sourceLabel: b.sourceLabel, sourceUrl: b.sourceUrl, frameMs: b.timestampMs ?? null, frameAt, rightsNote: b.rightsNote.trim(), faces: analysis.stats.faces, processing: "face detection + quality scoring only; no recognition" });
      return jobId;
    });
    const f = analysis.frames[0]!;
    return reply.code(201).send({
      jobId: id,
      status: "done",
      source: { label: b.sourceLabel, url: b.sourceUrl, frameMs: b.timestampMs ?? null, frameAt },
      frame: { width: f.width, height: f.height, url: `/admin/pipeline/jobs/${id}/frames/0.jpg` },
      candidates: analysis.candidates.map((k) => ({ rank: k.rank, frameNo: k.frameNo, frameMs: k.frameMs, box: k.box, scores: k.scores, width: k.width, height: k.height, lowRes: k.lowRes, bytes: k.bytes.length, previewUrl: previewUrl(id, k.rank) })),
      stats: analysis.stats,
    });
  });

  app.get("/admin/pipeline/jobs/:id", async (req) => {
    requireAdmin(req);
    return loadJob(Id.parse(req.params).id);
  });

  // Admin-only private previews (never via /art).
  app.get<{ Params: { id: string; file: string } }>("/admin/pipeline/jobs/:id/candidates/:file", async (req, reply) => {
    requireAdmin(req);
    const { id } = Id.parse({ id: req.params.id });
    const m = /^([1-3])\.webp$/.exec(req.params.file);
    if (!m) fail("NOT_FOUND", "Candidate not found");
    const r = await pool.query("SELECT bytes FROM pipeline_candidates WHERE job_id=$1 AND rank=$2", [id, Number(m[1])]);
    if (!r.rowCount) fail("NOT_FOUND", "Candidate not found");
    return privateImage(reply, "image/webp", r.rows[0].bytes);
  });
  app.get<{ Params: { id: string; file: string } }>("/admin/pipeline/jobs/:id/frames/:file", async (req, reply) => {
    requireAdmin(req);
    const { id } = Id.parse({ id: req.params.id });
    const m = /^(\d{1,4})\.jpg$/.exec(req.params.file);
    if (!m) fail("NOT_FOUND", "Frame not found");
    const r = await pool.query("SELECT mime, bytes FROM pipeline_frames WHERE job_id=$1 AND frame_no=$2", [id, Number(m[1])]);
    if (!r.rowCount) fail("NOT_FOUND", "Frame not found");
    return privateImage(reply, r.rows[0].mime, r.rows[0].bytes);
  });

  // ---------- pick (candidate rank or custom box) → compose card → card_art → Studio draft ----------
  app.post("/admin/pipeline/jobs/:id/pick", async (req, reply) => {
    const s = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const b = PickBody.parse(req.body);
    if (!(await needDeps(reply, ["sharp"]))) return reply;
    const j = (await pool.query("SELECT * FROM pipeline_jobs WHERE id=$1", [id])).rows[0];
    if (!j) fail("NOT_FOUND", "Pipeline job not found");
    if (j.status !== "done") fail("CONFLICT", `Job is ${j.status}; wait until it is done`);
    if (!j.rights_confirmed) fail("VALIDATION", "Job has no rights confirmation");

    let cand: any = null;
    if (b.rank !== undefined) {
      cand = (await pool.query("SELECT rank, frame_no, frame_ms, crop_box FROM pipeline_candidates WHERE job_id=$1 AND rank=$2", [id, b.rank])).rows[0];
      if (!cand) fail("NOT_FOUND", "Candidate not found");
    }
    let frameNo: number;
    if (cand) frameNo = cand.frame_no;
    else if (b.frameNo !== undefined) frameNo = b.frameNo;
    else {
      const fr = await pool.query("SELECT frame_no FROM pipeline_frames WHERE job_id=$1 ORDER BY frame_no", [id]);
      if (fr.rowCount !== 1) fail("VALIDATION", "This job has several frames: pass rank or frameNo with the box");
      frameNo = fr.rows[0].frame_no;
    }
    const frame = (await pool.query("SELECT frame_no, frame_ms, width, height, bytes FROM pipeline_frames WHERE job_id=$1 AND frame_no=$2", [id, frameNo])).rows[0];
    if (!frame) fail("NOT_FOUND", "Frame not found");

    const box: Box = clampBox(b.box ?? (cand.crop_box as Box), frame.width, frame.height);
    const photo = await cropWebp(frame.bytes, box, outputSize(box.h));
    const art = await composeCard(photo, { name: b.cardName, member: b.fazeMember, rarity: b.rarity, setLabel: b.setLabel });
    const frameMs: number | null = frame.frame_ms ?? j.source_frame_ms ?? null;
    const frameAt: string | null = j.source_frame_at ? new Date(j.source_frame_at).toISOString() : null;
    const source: ArtSource = { jobId: id, rank: b.box ? null : (cand?.rank ?? null), box, frameMs, frameAt, label: j.source_label, url: j.source_url, rightsNote: j.rights_note };

    const out = await tx(async (c) => {
      const { url } = await storeArt(c, { mime: "image/webp", bytes: art });
      const draft = await attachToDraft(c, {
        actor: s.sub,
        artUrl: url,
        card: { name: b.cardName, member: b.fazeMember, rarity: b.rarity, setLabel: b.setLabel },
        target: { campaignId: b.campaignId, assetId: b.assetId },
        source,
      });
      await audit(c, s.sub, "pipeline.pick", id, {
        rank: source.rank, customBox: !!b.box, box, frameMs, frameAt, artUrl: url,
        campaignId: draft.campaignId, assetId: draft.assetId, draftCreated: draft.created,
        sourceLabel: j.source_label, sourceUrl: j.source_url, rightsNote: j.rights_note,
      });
      return { artUrl: url, draft };
    });
    return {
      artUrl: out.artUrl,
      draft: out.draft,
      artSource: { jobId: id, rank: source.rank, box, frameMs, frameAt, sourceLabel: source.label, sourceUrl: source.url, rightsNote: source.rightsNote },
      card: { width: 1000, height: 1200, mime: "image/webp", bytes: art.length },
    };
  });
}
