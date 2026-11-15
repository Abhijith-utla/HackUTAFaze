// In-process job runner for MP4 face-art jobs: one job at a time, bounded queue, per-job timeout.
// Upload bytes live only in memory until the job runs, then in a temp dir removed in `finally`.
// Jobs are claimed with a status-guarded UPDATE, so the runner can move to services/worker later.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { analyzeVideo, type Analysis } from "./analyze.js";
import { withTempDir } from "./frames.js";

export const MAX_WAITING = 3;
const timeoutMs = () => Number(process.env.PIPELINE_JOB_TIMEOUT_MS) || 120_000;

type VideoAnalyzer = (file: string, signal: AbortSignal) => Promise<Analysis>;
let analyzer: VideoAnalyzer = analyzeVideo;
/** Test hook: replace the MP4 analyzer (null restores the real one). */
export function setVideoAnalyzer(a: VideoAnalyzer | null) { analyzer = a ?? analyzeVideo; }
export const videoAnalyzerOverridden = () => analyzer !== analyzeVideo;

const queue: { id: string; bytes: Buffer }[] = [];
let running = false;
let swept = false;

/** Writes frames + candidates and marks the job done (one transaction). */
export async function saveAnalysis(c: PoolClient, jobId: string, a: Analysis) {
  for (const f of a.frames)
    await c.query("INSERT INTO pipeline_frames (job_id, frame_no, frame_ms, width, height, mime, bytes) VALUES ($1,$2,$3,$4,$5,$6,$7)", [jobId, f.frameNo, f.frameMs, f.width, f.height, f.mime, f.bytes]);
  for (const k of a.candidates)
    await c.query(
      "INSERT INTO pipeline_candidates (job_id, rank, frame_no, frame_ms, scores, crop_box, width, height, low_res, bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [jobId, k.rank, k.frameNo, k.frameMs, JSON.stringify(k.scores), JSON.stringify(k.box), k.width, k.height, k.lowRes, k.bytes],
    );
  await c.query("UPDATE pipeline_jobs SET status='done', stats=$2, error=NULL, finished_at=now(), updated_at=now() WHERE id=$1", [jobId, JSON.stringify(a.stats)]);
}

export function enqueueVideoJob(id: string, bytes: Buffer) {
  if (queue.length >= MAX_WAITING) fail("CONFLICT", "Face-art pipeline is busy; try again shortly");
  queue.push({ id, bytes });
  void pump();
}

/** Reserves a queue slot before the job row is written. */
export function assertQueueRoom() {
  if (queue.length >= MAX_WAITING) fail("CONFLICT", "Face-art pipeline is busy; try again shortly");
}

async function pump() {
  if (running) return;
  running = true;
  try {
    if (!swept) {
      swept = true; // jobs orphaned by a restart can never finish (their upload was in memory)
      await pool.query("UPDATE pipeline_jobs SET status='failed', error='Interrupted (API restarted); upload again', updated_at=now() WHERE kind='face_art' AND status IN ('queued','running') AND updated_at < now() - interval '15 minutes'").catch(() => {});
    }
    for (let j = queue.shift(); j; j = queue.shift()) await runOne(j.id, j.bytes);
  } finally {
    running = false;
  }
}

async function runOne(id: string, bytes: Buffer) {
  const claim = await pool.query("UPDATE pipeline_jobs SET status='running', started_at=now(), updated_at=now() WHERE id=$1 AND status='queued' RETURNING id", [id]).catch(() => ({ rowCount: 0 }));
  if (!claim.rowCount) return;
  const ac = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ac.abort(); reject(new Error(`Pipeline job timed out after ${Math.round(timeoutMs() / 1000)} s`)); }, timeoutMs());
  });
  try {
    const analysis = await withTempDir(async (dir) => {
      const file = path.join(dir, "source.mp4");
      await writeFile(file, bytes);
      return Promise.race([analyzer(file, ac.signal), timeout]);
    });
    await tx((c) => saveAnalysis(c, id, analysis));
  } catch (e) {
    await pool.query("UPDATE pipeline_jobs SET status='failed', error=$2, finished_at=now(), updated_at=now() WHERE id=$1", [id, String((e as Error).message).slice(0, 500)]).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}
