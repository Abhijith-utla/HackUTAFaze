import type { Db } from "../db.js";
import type { VideoMetadata } from "./youtube.js";

export async function audit(db: Db, actor: string | null, action: string, id: string | null, detail: object = {}) {
  await db.query("INSERT INTO audit_log (actor_id,action,entity,entity_id,detail) VALUES ($1,$2,'scout',$3,$4)", [actor, `scout.${action}`, id, JSON.stringify(detail)]);
}

/** Run on startup, every minute and before Scout reads/writes. No stale previews are served. */
export async function expireMetadata(db: Db) {
  const expired = await db.query(`UPDATE scout_candidates SET metadata=NULL
    WHERE metadata IS NOT NULL AND fetched_at <= now()-interval '30 days' RETURNING video_id`);
  if (expired.rowCount) await audit(db, null, "expire", null, { count: expired.rowCount });
  await db.query(`UPDATE scout_source SET next_page=NULL,completed=false,pages_scanned=0,last_scan_at=NULL
    WHERE last_scan_at <= now()-interval '30 days'`);
}

export async function saveVideo(db: Db, id: string, metadata: VideoMetadata) {
  await db.query(`INSERT INTO scout_candidates (video_id,metadata) VALUES ($1,$2)
    ON CONFLICT(video_id) DO UPDATE SET metadata=EXCLUDED.metadata,fetched_at=now()`, [id, JSON.stringify(metadata)]);
}
