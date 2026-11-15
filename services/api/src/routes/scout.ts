import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { audit, expireMetadata, saveVideo } from "../scout/store.js";
import { CHANNEL_ID, configured, VIDEO_ID, watchUrl, youtubeClient, type VideoMetadata } from "../scout/youtube.js";

const BASE = "/admin/control/scout";
const Params = z.object({ id: z.string().regex(VIDEO_ID) });
const Status = z.enum(["new", "shortlisted", "rejected", "promoted"]);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(s); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s && +d <= Date.now();
}, "Use a valid date in the past");

export async function scoutRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => { requireAdmin(req); });
  // Bounded retention, including during periods when nobody opens this page.
  let cleanup: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    await tx(expireMetadata);
    if (!process.env.VITEST) {
      cleanup = setInterval(() => { void tx(expireMetadata).catch(() => app.log.error("Scout metadata cleanup failed")); }, 60_000);
      cleanup.unref();
    }
  });
  app.addHook("onClose", async () => { if (cleanup) clearInterval(cleanup); });

  app.get(BASE, async (req) => {
    const q = z.object({
      status: z.union([Status, z.literal("all")]).default("new"),
      q: z.string().max(150).default(""), minViews: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      year: z.coerce.number().int().min(2005).max(new Date().getUTCFullYear()).optional(),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }).parse(req.query);
    return tx(async (db) => {
      await expireMetadata(db);
      const source = (await db.query("SELECT * FROM scout_source WHERE id=true")).rows[0];
      const where = `($1='all' OR status=$1) AND
        ($2='' OR strpos(lower(COALESCE(metadata->>'title',video_id)),lower($2))>0) AND
        ($3::bigint=0 OR (metadata->>'views')::bigint >= $3) AND
        ($4::int IS NULL OR left(metadata->>'publishedAt',4)::int=$4)`;
      const params = [q.status, q.q, q.minViews, q.year ?? null];
      const count = (await db.query(`SELECT count(*)::int AS n FROM scout_candidates WHERE ${where}`, params)).rows[0].n;
      const rows = await db.query(`SELECT * FROM scout_candidates WHERE ${where}
        ORDER BY (metadata->>'views')::bigint DESC NULLS LAST, video_id LIMIT 30 OFFSET $5`, [...params, q.offset]);
      const counts = (await db.query("SELECT status,count(*)::int AS n FROM scout_candidates GROUP BY status")).rows;
      return {
        configured: configured(), channel: { id: CHANNEL_ID, name: "FaZe Clan", url: `https://www.youtube.com/channel/${CHANNEL_ID}` },
        source: { hasMore: !source.completed, pagesScanned: source.pages_scanned, lastScanAt: source.last_scan_at },
        counts: Object.fromEntries(counts.map((r) => [r.status, r.n])), total: count, offset: q.offset,
        candidates: rows.rows.map((r) => ({
          videoId: r.video_id, videoUrl: watchUrl(r.video_id), metadata: r.metadata,
          fetchedAt: r.fetched_at, status: r.status, note: r.note, momentId: r.moment_id,
        })),
      };
    });
  });

  app.post(`${BASE}/scan`, async (req) => {
    const actor = requireAdmin(req).sub;
    const { restart } = z.object({ restart: z.boolean().default(false) }).parse(req.body ?? {});
    const yt = youtubeClient();
    return tx(async (db) => {
      if (!(await db.query("SELECT pg_try_advisory_xact_lock(424243) AS locked")).rows[0].locked) fail("CONFLICT", "A Scout scan is already running. Wait for it to finish.");
      await expireMetadata(db);
      const state = (await db.query("SELECT * FROM scout_source WHERE id=true FOR UPDATE")).rows[0];
      if (state.last_scan_at && Date.now() - +new Date(state.last_scan_at) < 30_000) fail("CONFLICT", "Please wait 30 seconds between scans to conserve YouTube quota.");
      if (state.completed && !restart) fail("CONFLICT", "Discovery reached the end. Restart from latest uploads to scan again.");
      let next: string | null = restart ? null : state.next_page;
      let pages = 0; let saved = 0;
      const playlist = await yt.uploads();
      do {
        const page = await yt.page(playlist, next);
        const videos = await yt.videos(page.ids);
        for (const video of videos) { await saveVideo(db, video.id, video.metadata); saved++; }
        next = page.nextPage;
        pages++;
      } while (next && pages < 3);
      await db.query(`UPDATE scout_source SET next_page=$1,completed=$2,pages_scanned=$3,last_scan_at=now() WHERE id=true`, [next, !next, (restart ? 0 : state.pages_scanned) + pages]);
      await audit(db, actor, "scan", null, { saved, pages, requests: yt.requests(), restart, completed: !next });
      return { saved, pages, requests: yt.requests(), hasMore: Boolean(next) };
    });
  });

  app.post(`${BASE}/:id/refresh`, async (req) => {
    const actor = requireAdmin(req).sub;
    const { id } = Params.parse(req.params);
    const yt = youtubeClient();
    return tx(async (db) => {
      const row = (await db.query("SELECT * FROM scout_candidates WHERE video_id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) fail("NOT_FOUND", "Candidate not found");
      if (Date.now() - +new Date(row.fetched_at) < 30_000) fail("CONFLICT", "This metadata was just retrieved. Wait 30 seconds before refreshing.");
      const video = (await yt.videos([id]))[0];
      if (video) await saveVideo(db, id, video.metadata);
      else {
        await db.query("UPDATE scout_candidates SET metadata=NULL,fetched_at=now() WHERE video_id=$1", [id]);
      }
      await audit(db, actor, "refresh", id, { available: Boolean(video) });
      return { available: Boolean(video) };
    });
  });

  app.patch(`${BASE}/:id`, async (req) => {
    const actor = requireAdmin(req).sub;
    const { id } = Params.parse(req.params);
    const body = z.object({ status: z.enum(["new", "shortlisted", "rejected"]), note: z.string().trim().max(1000).default("") }).parse(req.body);
    return tx(async (db) => {
      const row = (await db.query("SELECT status FROM scout_candidates WHERE video_id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) fail("NOT_FOUND", "Candidate not found");
      if (row.status === "promoted") fail("CONFLICT", "This moment is already in the archive. Manage it in the Control Room.");
      await db.query("UPDATE scout_candidates SET status=$2,note=$3,reviewed_by=$4,reviewed_at=now() WHERE video_id=$1", [id, body.status, body.note, actor]);
      await audit(db, actor, "review", id, { from: row.status, to: body.status });
      return { status: body.status };
    });
  });

  app.post(`${BASE}/:id/promote`, async (req) => {
    const actor = requireAdmin(req).sub;
    const { id } = Params.parse(req.params);
    const body = z.object({
      title: z.string().trim().min(3).max(160), summary: z.string().trim().min(20).max(2000),
      members: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
      occurredOn: DateOnly, timestampSeconds: z.number().int().min(0).max(86400).default(0),
    }).parse(req.body);
    return tx(async (db) => {
      await expireMetadata(db);
      const row = (await db.query("SELECT * FROM scout_candidates WHERE video_id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) fail("NOT_FOUND", "Candidate not found");
      if (row.status === "promoted") return { momentId: row.moment_id };
      if (row.status !== "shortlisted") fail("CONFLICT", "Shortlist this video before adding it to the archive.");
      const metadata = row.metadata as VideoMetadata | null;
      if (!metadata) fail("CONFLICT", "Video metadata expired or is unavailable. Refresh it before promoting.");
      const source = `YouTube ${watchUrl(id, body.timestampSeconds)}`;
      const moment = await db.query(`INSERT INTO archive_moments (key,occurred_on,precision,title,summary,members,tags,source,citations,search)
        VALUES ($1,$2,'day',$3,$4,$5,ARRAY['youtube','curated'],$6,$7,
          setweight(to_tsvector('english',$3),'A') || setweight(to_tsvector('english',array_to_string($5::text[],' ')),'A') || setweight(to_tsvector('english',$4),'B'))
        ON CONFLICT(key) DO NOTHING RETURNING id`, [`yt:${id}`, body.occurredOn, body.title, body.summary, [...new Set(body.members)], source, [watchUrl(id, body.timestampSeconds)]]);
      const momentId = moment.rows[0]?.id;
      if (!momentId) fail("CONFLICT", "This video already has an archive moment. Find it in KAM archive search.");
      await db.query("UPDATE scout_candidates SET status='promoted',moment_id=$2,editorial_summary=$3,reviewed_by=$4,reviewed_at=now() WHERE video_id=$1", [id, momentId, body.summary, actor]);
      await audit(db, actor, "promote", id, { momentId });
      return { momentId };
    });
  });
}
