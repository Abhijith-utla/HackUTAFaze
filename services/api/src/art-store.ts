import { createHash } from "node:crypto";
import { config } from "./config.js";

/** Anything with pg's query shape: pool, PoolClient, or a test fake. */
export type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const ART_MAX_BYTES = 2 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** File extension for a stored card_art mime (png|jpg|webp|svg). Throws on anything else. */
export function artExt(mime: string): string {
  const ext = EXT[mime];
  if (!ext) throw new Error(`Unsupported art mime: ${mime}`);
  return ext;
}

/** Mime for a URL extension, or undefined. */
export function mimeForExt(ext: string): string | undefined {
  const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
  return Object.keys(EXT).find((m) => EXT[m] === e);
}

const artUrl = (id: string, mime: string) => `/art/${id}.${artExt(mime)}`;

function check(mime: string, bytes: Buffer) {
  artExt(mime);
  if (!bytes.length || bytes.length > ART_MAX_BYTES) throw new Error("Art must be 1 byte to 2MB");
}

/**
 * Stores trusted art (admin upload or seed import) in card_art and returns its relative URL.
 * Callers validate content first; SVG is only for trusted seed files.
 * Dedupes on sha256 + mime so seeding is idempotent. Rows held by fan-art submissions are
 * never reused (they stay private until moderation approves them).
 */
export async function storeArt(
  q: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  input: { mime: string; bytes: Buffer; demo?: boolean },
): Promise<{ id: string; url: string }> {
  check(input.mime, input.bytes);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await q.query(
    `SELECT a.id FROM card_art a
      WHERE a.sha256=$1 AND a.mime=$2
        AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.kind='fan_art' AND s.payload->>'artId' = a.id::text)
      ORDER BY a.created_at LIMIT 1`,
    [sha256, input.mime],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, url: artUrl(existing.rows[0].id, input.mime) };
  const r = await q.query("INSERT INTO card_art (mime, bytes, sha256, demo) VALUES ($1,$2,$3,$4) RETURNING id", [
    input.mime,
    input.bytes,
    sha256,
    input.demo ?? false,
  ]);
  return { id: r.rows[0].id, url: artUrl(r.rows[0].id, input.mime) };
}

/** Fan-art bytes: always a fresh private row (no dedupe), referenced from the submission payload. */
export async function storeFanArt(q: Queryable, input: { mime: string; bytes: Buffer }): Promise<{ id: string }> {
  check(input.mime, input.bytes);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const r = await q.query("INSERT INTO card_art (mime, bytes, sha256, demo) VALUES ($1,$2,$3,false) RETURNING id", [
    input.mime,
    input.bytes,
    sha256,
  ]);
  return { id: r.rows[0].id };
}

/**
 * Loads servable art: demo rows, rows used by a card, and anything not held by a
 * pending/rejected fan-art submission. Returns null when unknown or still under moderation.
 */
export async function loadPublicArt(q: Queryable, id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const r = await q.query(
    `SELECT a.mime, a.bytes FROM card_art a
      WHERE a.id=$1
        AND (a.demo
          OR EXISTS (SELECT 1 FROM cards c WHERE c.art_url LIKE '/art/' || a.id::text || '%')
          OR NOT EXISTS (SELECT 1 FROM submissions s WHERE s.kind='fan_art' AND s.payload->>'artId' = a.id::text AND s.status <> 'approved'))`,
    [id],
  );
  return r.rows[0] ? { mime: r.rows[0].mime, bytes: r.rows[0].bytes } : null;
}

const OWN_ART_PATH = /^\/(art|uploaded-art|demo-art)\//;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * v1.5: artUrl is stored relative. An absolute URL pointing at this API's own art routes
 * (its public host or a loopback host) is reduced to its path; external URLs are kept as given.
 */
export function relativeArtUrl(input: string): string {
  const s = input.trim();
  if (!/^https?:\/\//i.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return s;
  }
  let own = LOOPBACK.has(url.hostname);
  try {
    own ||= url.host === new URL(config.publicUrl).host;
  } catch {
    /* bad PUBLIC_API_URL: only loopback counts as own */
  }
  return own && OWN_ART_PATH.test(url.pathname) ? url.pathname + url.search : s;
}
