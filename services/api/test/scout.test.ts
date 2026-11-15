import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeAdmin, makeApp, pool, signup } from "./helpers.js";
import { CHANNEL_ID, normalizeVideo } from "../src/scout/youtube.js";

const BASE = "/admin/control/scout";
const ids: string[] = [];
const newId = () => { const id = randomUUID().replaceAll("-", "").slice(0, 11); ids.push(id); return id; };
const video = (id: string, views = "1234567") => ({
  id, snippet: { channelId: CHANNEL_ID, title: `Test FaZe moment ${id}`, publishedAt: "2012-10-08T00:00:00Z", thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480 } } },
  statistics: { viewCount: views, likeCount: "1234" }, contentDetails: { duration: "PT5M30S" },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const promotion = { title: "A team milestone", summary: "Curator-authored context about a memorable team highlight.", members: ["Rain"], occurredOn: "2012-10-08", timestampSeconds: 42 };
let app: FastifyInstance;
let admin: { id: string; cookie: string };
let fetchMock = vi.fn();
const asAdmin = () => ({ headers: { cookie: admin.cookie } });
async function readScoutViews(db: typeof pool) {
  const rows = (await db.query("SELECT moment_key,views FROM scout_moment_views WHERE fetched_at>now()-interval '30 days'")).rows;
  return new Map(rows.map((r) => [r.moment_key, Number(r.views)]));
}
async function seed(status = "new", ageDays = 0) {
  const id = newId();
  const metadata = normalizeVideo(video(id))!.metadata;
  await pool.query("INSERT INTO scout_candidates(video_id,metadata,status,fetched_at) VALUES ($1,$2,$3,now()-($4::int*interval '1 day'))", [id, JSON.stringify(metadata), status, ageDays]);
  return id;
}

beforeAll(async () => { app = await makeApp(); admin = await makeAdmin(); });
beforeEach(async () => {
  vi.stubEnv("YOUTUBE_API_KEY", "scout-test-secret");
  fetchMock = vi.fn().mockRejectedValue(new Error("Unexpected upstream request"));
  vi.stubGlobal("fetch", fetchMock);
  await pool.query("UPDATE scout_source SET next_page=NULL,completed=false,pages_scanned=0,last_scan_at=NULL");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await pool.query("DELETE FROM scout_candidates WHERE video_id=ANY($1)", [ids]);
  await pool.query("DELETE FROM archive_moments WHERE key=ANY($1)", [ids.map((id) => `yt:${id}`)]);
  await app.close(); await pool.end();
});

describe("Scout boundary and metadata", () => {
  it("requires an admin on every route before contacting YouTube", async () => {
    const fan = await signup(app);
    const id = newId();
    for (const [method, url] of [["GET", BASE], ["POST", `${BASE}/scan`], ["POST", `${BASE}/${id}/refresh`], ["PATCH", `${BASE}/${id}`], ["POST", `${BASE}/${id}/promote`]] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      expect((await app.inject({ method, url, headers: { cookie: fan.cookie } })).statusCode).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows setup state and refuses discovery without a server key", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    expect((await app.inject({ method: "GET", url: BASE, ...asAdmin() })).json().configured).toBe(false);
    const r = await app.inject({ method: "POST", url: `${BASE}/scan`, ...asAdmin() });
    expect(r.statusCode).toBe(409); expect(r.json().error.message).toContain("Configure YOUTUBE_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps missing counts unknown, accepts only official videos and safe thumbnails", () => {
    const id = newId();
    expect(normalizeVideo(video(id))?.metadata.comments).toBeNull();
    expect(normalizeVideo({ ...video(id), snippet: { ...video(id).snippet, channelId: "other" } })).toBeNull();
    expect(normalizeVideo({ ...video(id), snippet: { ...video(id).snippet, thumbnails: { high: { url: "javascript:alert(1)" } } } })?.metadata.thumbnailUrl).toBeNull();
    expect(normalizeVideo(video(id, "NaN"))).toBeNull();
  });
});

describe("Resumable discovery", () => {
  it("caps scans at three pages, deduplicates, resumes older uploads and preserves decisions", async () => {
    const a = newId(), b = newId(), c = newId(), d = newId();
    const pageTokens: (string | null)[] = [];
    const pages: Record<string, { ids: string[]; next?: string }> = {
      latest: { ids: [a, b], next: "page2" }, page2: { ids: [a], next: "page3" }, page3: { ids: [c], next: "older" }, older: { ids: [d] },
    };
    fetchMock.mockImplementation(async (input: URL, options: RequestInit) => {
      const u = new URL(input);
      expect(u.origin).toBe("https://www.googleapis.com");
      expect(u.search).not.toContain("scout-test-secret");
      expect(options.headers).toMatchObject({ "X-Goog-Api-Key": "scout-test-secret" });
      expect(u.pathname).not.toContain("search");
      if (u.pathname.endsWith("/channels")) return json({ items: [{ id: CHANNEL_ID, contentDetails: { relatedPlaylists: { uploads: "uploads" } } }] });
      if (u.pathname.endsWith("/playlistItems")) {
        const token = u.searchParams.get("pageToken"); pageTokens.push(token);
        const p = pages[token ?? "latest"];
        return json({ items: p.ids.map((id) => ({ contentDetails: { videoId: id } })), nextPageToken: p.next });
      }
      return json({ items: u.searchParams.get("id")!.split(",").map((id) => video(id, id === b ? "9999999" : "1000")) });
    });
    let result = await app.inject({ method: "POST", url: `${BASE}/scan`, ...asAdmin() });
    expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ pages: 3, requests: 7, hasMore: true });
    expect((await pool.query("SELECT count(*)::int AS n FROM scout_candidates WHERE video_id=ANY($1)", [[a,b,c]])).rows[0].n).toBe(3);
    expect((await app.inject({ method: "POST", url: `${BASE}/scan`, ...asAdmin() })).statusCode).toBe(409);
    await pool.query("UPDATE scout_source SET last_scan_at=now()-interval '31 seconds'");
    result = await app.inject({ method: "POST", url: `${BASE}/scan`, ...asAdmin() });
    expect(result.json()).toMatchObject({ pages: 1, saved: 1, hasMore: false });
    expect(pageTokens).toEqual([null, "page2", "page3", "older"]);
    await app.inject({ method: "PATCH", url: `${BASE}/${a}`, payload: { status: "rejected", note: "Not an iconic moment" }, ...asAdmin() });
    await pool.query("UPDATE scout_source SET last_scan_at=now()-interval '31 seconds'");
    await app.inject({ method: "POST", url: `${BASE}/scan`, payload: { restart: true }, ...asAdmin() });
    expect((await pool.query("SELECT status,note FROM scout_candidates WHERE video_id=$1", [a])).rows[0]).toEqual({ status: "rejected", note: "Not an iconic moment" });
    const listing = (await app.inject({ method: "GET", url: `${BASE}?status=all&minViews=9000000&year=2012`, ...asAdmin() })).json();
    expect(listing.candidates.map((v: {videoId:string}) => v.videoId)).toContain(b);
    expect(listing.candidates.every((v: {metadata:{views:number}}) => v.metadata.views >= 9e6)).toBe(true);
  });
  it("rolls back partial scans and does not leak upstream error details", async () => {
    const id = newId();
    fetchMock.mockResolvedValueOnce(json({ items: [{ id: CHANNEL_ID, contentDetails: { relatedPlaylists: { uploads: "uploads" } } }] }))
      .mockResolvedValueOnce(json({ items: [{ contentDetails: { videoId: id } }], nextPageToken: "more" }))
      .mockResolvedValueOnce(json({ items: [video(id)] }))
      .mockResolvedValueOnce(json({ error: { message: "secret scout-test-secret" } }, 403));
    const r = await app.inject({ method: "POST", url: `${BASE}/scan`, ...asAdmin() });
    expect(r.statusCode).toBe(409); expect(r.body).not.toContain("scout-test-secret");
    expect((await pool.query("SELECT * FROM scout_candidates WHERE video_id=$1", [id])).rowCount).toBe(0);
    expect((await pool.query("SELECT pages_scanned FROM scout_source")).rows[0].pages_scanned).toBe(0);
  });
  it("serializes discovery across API instances", async () => {
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN"); await lock.query("SELECT pg_advisory_xact_lock(424243)");
      const r = await app.inject({ method: "POST", url: `${BASE}/scan`, ...asAdmin() });
      expect(r.statusCode).toBe(409); expect(fetchMock).not.toHaveBeenCalled();
    } finally { await lock.query("ROLLBACK"); lock.release(); }
  });
});

describe("Editorial screening and KAM integration", () => {
  it("requires shortlist, promotes once, keeps stats out of lore and expires KAM evidence", async () => {
    const id = await seed();
    const promote = () => app.inject({ method: "POST", url: `${BASE}/${id}/promote`, payload: promotion, ...asAdmin() });
    expect((await promote()).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `${BASE}/${id}`, payload: { status: "shortlisted", note: "Reviewed video" }, ...asAdmin() })).statusCode).toBe(200);
    const result = await promote(); expect(result.statusCode).toBe(200);
    expect((await promote()).json().momentId).toBe(result.json().momentId);
    const moment = (await pool.query("SELECT * FROM archive_moments WHERE id=$1", [result.json().momentId])).rows[0];
    expect(moment.summary).toBe(promotion.summary); expect(moment.title).toBe(promotion.title);
    expect(moment.source).toBe(`YouTube https://www.youtube.com/watch?v=${id}&t=42s`);
    expect((await pool.query("SELECT search @@ websearch_to_tsquery('english','memorable') AS found FROM archive_moments WHERE id=$1", [moment.id])).rows[0].found).toBe(true);
    expect((await readScoutViews(pool)).get(`yt:${id}`)).toBe(1234567);
    expect((await app.inject({ method: "PATCH", url: `${BASE}/${id}`, payload: { status: "rejected" }, ...asAdmin() })).statusCode).toBe(409);
    await pool.query("UPDATE scout_candidates SET fetched_at=now()-interval '31 days' WHERE video_id=$1", [id]);
    expect((await readScoutViews(pool)).has(`yt:${id}`)).toBe(false);
    await app.inject({ method: "GET", url: BASE, ...asAdmin() });
    const expired = (await pool.query("SELECT metadata,status FROM scout_candidates WHERE video_id=$1", [id])).rows[0];
    expect(expired).toEqual({ metadata: null, status: "promoted" });
    expect((await pool.query("SELECT summary FROM archive_moments WHERE id=$1", [moment.id])).rows[0].summary).toBe(promotion.summary);
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1 AND action='scout.promote'", [id])).rows[0].n).toBe(1);
  });
  it("blocks stale promotion, refreshes public metadata and clears unavailable videos", async () => {
    const id = await seed("shortlisted", 31);
    expect((await app.inject({ method: "POST", url: `${BASE}/${id}/promote`, payload: promotion, ...asAdmin() })).statusCode).toBe(409);
    fetchMock.mockResolvedValueOnce(json({ items: [video(id)] }));
    expect((await app.inject({ method: "POST", url: `${BASE}/${id}/refresh`, ...asAdmin() })).json().available).toBe(true);
    await pool.query("UPDATE scout_candidates SET fetched_at=now()-interval '31 seconds' WHERE video_id=$1", [id]);
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    expect((await app.inject({ method: "POST", url: `${BASE}/${id}/refresh`, ...asAdmin() })).json().available).toBe(false);
    expect((await pool.query("SELECT metadata,status FROM scout_candidates WHERE video_id=$1", [id])).rows[0]).toEqual({ metadata: null, status: "shortlisted" });
  });
  it("validates inputs and never requests arbitrary URLs", async () => {
    const id = await seed("shortlisted");
    expect((await app.inject({ method: "POST", url: `${BASE}/${id}/promote`, payload: { ...promotion, occurredOn: "2012-02-31" }, ...asAdmin() })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `${BASE}?offset=-1`, ...asAdmin() })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `${BASE}/${id}`, payload: { status: "promoted" }, ...asAdmin() })).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
