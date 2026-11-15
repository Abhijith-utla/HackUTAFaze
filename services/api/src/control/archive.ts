// FaZe Control Room (lead, contract v1.6): historical archive loader + search.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ARCHIVE_FILE = process.env.ARCHIVE_FILE || path.join(here, "..", "..", "..", "..", "content", "archive", "faze-timeline.json");

type ArchiveFileMoment = {
  key: string;
  occurredOn: string;
  precision: "day" | "month" | "year";
  title: string;
  summary: string;
  members: string[];
  tags: string[];
  source: string;
  citations: string[];
};

/** Idempotent: inserts any archive moments not already loaded (by key). Returns rows inserted. */
export async function ensureArchive(db: Db, file = ARCHIVE_FILE): Promise<number> {
  const have = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM archive_moments");
  const doc = JSON.parse(await readFile(file, "utf8")) as { moments: ArchiveFileMoment[] };
  if (Number(have.rows[0].n) >= doc.moments.length) return 0;
  let inserted = 0;
  for (const m of doc.moments) {
    const r = await db.query(
      `INSERT INTO archive_moments (key, occurred_on, precision, title, summary, members, tags, source, citations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (key) DO NOTHING`,
      [m.key, m.occurredOn, m.precision, m.title, m.summary, m.members, m.tags, m.source, m.citations],
    );
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

export function toMoment(r: any) {
  return {
    id: r.id as string,
    occurredOn: (r.occurred_on instanceof Date ? r.occurred_on.toISOString() : String(r.occurred_on)).slice(0, 10),
    precision: r.precision as string,
    title: r.title as string,
    summary: r.summary as string,
    members: r.members as string[],
    tags: r.tags as string[],
    source: r.source as string,
    citations: r.citations as string[],
  };
}

/** Full-text search (Postgres tsvector; no model needed). Empty q → most recent moments. */
export async function searchArchive(db: Db, q: string, member?: string, limit = 25) {
  const params: unknown[] = [];
  const where: string[] = [];
  let rank = "0";
  if (q.trim()) {
    params.push(q.trim());
    where.push(`search @@ websearch_to_tsquery('english', $${params.length})`);
    rank = `ts_rank(search, websearch_to_tsquery('english', $1))`;
  }
  if (member) {
    params.push(member);
    where.push(`$${params.length} = ANY(members)`);
  }
  params.push(Math.min(Math.max(limit, 1), 100));
  const r = await db.query(
    `SELECT *, ${rank} AS rank FROM archive_moments ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY rank DESC, occurred_on DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows.map((row) => ({ ...toMoment(row), rank: Number(row.rank) }));
}
