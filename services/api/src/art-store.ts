// TEMPORARY STUB (seed worktree only): the real art-store.ts comes from the parallel v1.5 art agent.
// Drop this file on merge in favour of theirs; the signatures below match the agreed interface.
import { createHash } from "node:crypto";

type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export function artExt(mime: string): string {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" } as Record<string, string>)[mime] ?? "bin";
}

export async function storeArt(q: Q, input: { mime: string; bytes: Buffer; demo?: boolean }): Promise<{ id: string; url: string }> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const found = await q.query("SELECT id FROM card_art WHERE sha256=$1 AND mime=$2 LIMIT 1", [sha256, input.mime]);
  const id: string =
    found.rows[0]?.id ??
    (
      await q.query("INSERT INTO card_art (mime, bytes, sha256, demo) VALUES ($1,$2,$3,$4) RETURNING id", [
        input.mime,
        input.bytes,
        sha256,
        input.demo ?? false,
      ])
    ).rows[0].id;
  return { id, url: `/art/${id}.${artExt(input.mime)}` };
}
