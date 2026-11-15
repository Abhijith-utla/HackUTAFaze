// Attaches picked/composed art to a Moment Studio draft (campaign_assets), never to live `cards`.
// The draft still has to pass the existing submit → review (rightsConfirmed) → launch flow.
import type { PoolClient } from "pg";
import { fail } from "../errors.js";
import { findDuplicate } from "../control/studio.js";
import type { Rarity } from "./compose.js";
import type { Box } from "./score.js";

// Same power/supply plan Moment Studio uses per rarity (src/control/studio.ts PLAN).
const POWER: Record<Rarity, number> = { common: 22, rare: 38, epic: 57, legendary: 82 };
const SUPPLY: Record<Rarity, number | null> = { common: null, rare: null, epic: 250, legendary: 50 };
const EDITABLE = ["draft", "rejected"];

export type ArtSource = { jobId: string; rank: number | null; box: Box; frameMs: number | null; frameAt: string | null; label: string; url: string | null; rightsNote: string };

/** "1:23.450" for clip offsets; ISO for wall-clock captures. */
export function timestampLabel(frameMs: number | null, frameAt: string | null): string {
  if (frameMs !== null) {
    const m = Math.floor(frameMs / 60000), s = ((frameMs % 60000) / 1000).toFixed(3).padStart(6, "0");
    return `${m}:${s}`;
  }
  return frameAt ?? "unknown time";
}

export async function attachToDraft(
  c: PoolClient,
  input: {
    actor: string;
    artUrl: string;
    card: { name: string; member: string; rarity: Rarity; setLabel?: string };
    target: { campaignId?: string; assetId?: string };
    source: ArtSource;
  },
): Promise<{ campaignId: string; assetId: string; created: boolean; status: string; link: string }> {
  const { card, source } = input;
  const ts = timestampLabel(source.frameMs, source.frameAt);
  const lore = `Captured from ${source.label} at ${ts}.`.slice(0, 400);
  const others = (await c.query("SELECT id, name, faze_member FROM cards")).rows.map((x) => ({ id: x.id, name: x.name, fazeMember: x.faze_member }));
  const dup = findDuplicate(card.name, card.member, others);
  let campaignId = input.target.campaignId ?? null;
  let assetId: string;
  let created = false;

  if (campaignId) {
    const camp = await c.query("SELECT status FROM campaigns WHERE id=$1 FOR UPDATE", [campaignId]);
    if (!camp.rowCount) fail("NOT_FOUND", "Campaign not found");
    if (!EDITABLE.includes(camp.rows[0].status)) fail("CONFLICT", "Only draft campaigns can take new art");
  } else {
    const name = `Clip Lab: ${card.setLabel || source.label}`.slice(0, 80);
    const pitch = `Card art captured from ${source.label}${source.url ? ` (${source.url})` : ""} at ${ts}. Capture rights note: ${source.rightsNote}`.slice(0, 500);
    campaignId = (await c.query("INSERT INTO campaigns (name, pitch, generator, created_by) VALUES ($1,$2,'clip_lab',$3) RETURNING id", [name, pitch, input.actor])).rows[0].id as string;
    created = true;
  }

  if (input.target.assetId) {
    const a = await c.query("SELECT id, rarity FROM campaign_assets WHERE id=$1 AND campaign_id=$2 FOR UPDATE", [input.target.assetId, campaignId]);
    if (!a.rowCount) fail("NOT_FOUND", "Asset not found");
    const sameRarity = a.rows[0].rarity === card.rarity;
    await c.query(
      `UPDATE campaign_assets SET name=$2, faze_member=$3, rarity=$4, art_url=$5, duplicate_of=$6, similarity=$7,
         base_power = CASE WHEN $8 THEN base_power ELSE $9 END, max_supply = CASE WHEN $8 THEN max_supply ELSE $10 END
       WHERE id=$1`,
      [input.target.assetId, card.name, card.member, card.rarity, input.artUrl, dup?.id ?? null, dup?.similarity ?? null, sameRarity, POWER[card.rarity], SUPPLY[card.rarity]],
    );
    assetId = input.target.assetId;
  } else {
    const pos = (await c.query("SELECT coalesce(max(position) + 1, 0)::int AS p FROM campaign_assets WHERE campaign_id=$1", [campaignId])).rows[0].p as number;
    assetId = (
      await c.query(
        `INSERT INTO campaign_assets (campaign_id, position, name, faze_member, rarity, lore, art_url, base_power, max_supply, duplicate_of, similarity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [campaignId, pos, card.name, card.member, card.rarity, lore, input.artUrl, POWER[card.rarity], SUPPLY[card.rarity], dup?.id ?? null, dup?.similarity ?? null],
      )
    ).rows[0].id as string;
  }

  await c.query(
    `INSERT INTO campaign_asset_art_sources (asset_id, art_url, job_id, rank, crop_box, frame_ms, frame_at, source_label, source_url, rights_note, picked_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (asset_id) DO UPDATE SET art_url=EXCLUDED.art_url, job_id=EXCLUDED.job_id, rank=EXCLUDED.rank, crop_box=EXCLUDED.crop_box,
       frame_ms=EXCLUDED.frame_ms, frame_at=EXCLUDED.frame_at, source_label=EXCLUDED.source_label, source_url=EXCLUDED.source_url,
       rights_note=EXCLUDED.rights_note, picked_by=EXCLUDED.picked_by, picked_at=now()`,
    [assetId, input.artUrl, source.jobId, source.rank, JSON.stringify(source.box), source.frameMs, source.frameAt, source.label, source.url, source.rightsNote, input.actor],
  );
  // Any art change sends the drop back to draft: it must be re-submitted and re-reviewed (rights) before launch.
  await c.query("UPDATE campaigns SET status='draft', updated_at=now() WHERE id=$1", [campaignId]);
  return { campaignId, assetId, created, status: "draft", link: `/admin/control/campaigns/${campaignId}` };
}
