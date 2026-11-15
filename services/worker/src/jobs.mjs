import { randomInt } from "node:crypto";
export const blockedWords = ["fuck", "shit", "bitch", "asshole"];
export function moderationFlags(submission) {
  const p = submission.payload ?? {};
  const words = new Set(
    Object.values(p)
      .filter((v) => typeof v === "string")
      .join(" ")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
  const flags = [];
  if (blockedWords.some((word) => words.has(word))) flags.push("profanity");
  if (!["display_name", "trade_message", "fan_art"].includes(submission.kind))
    flags.push("invalid_kind");
  if (submission.kind === "fan_art") {
    // Only inspect actual bytes; client MIME/size claims never establish safety.
    const m =
      typeof p.imageData === "string"
        ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
            p.imageData,
          )
        : null;
    if (!m) flags.push("image_unverified");
    else {
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024)
        flags.push("image_size");
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp =
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP";
      if (!(
        (m[1] === "image/png" && png) ||
        (m[1] === "image/jpeg" && jpg) ||
        (m[1] === "image/webp" && webp)
      ))
        flags.push("image_type");
    }
  }
  return flags;
}
export function publishingErrors(cards, packs) {
  const errors = [];
  if (!cards.length) errors.push("Set has no cards");
  if (cards.some((c) => typeof c.art_url !== "string" || !c.art_url.trim()))
    errors.push("Every card needs art");
  if (!packs.length) errors.push("Set needs an active pack");
  for (const pack of packs) {
    const odds = pack.odds ?? {},
      values = Object.values(odds);
    if (
      !values.length ||
      values.some((v) => !Number.isFinite(v) || v < 0 || v > 100) ||
      Math.abs(values.reduce((a, b) => a + b, 0) - 100) > 1e-8
    )
      errors.push("Pack odds must sum to 100");
    if (
      Object.keys(odds).some(
        (r) =>
          !["common", "rare", "epic", "legendary"].includes(r) ||
          (odds[r] > 0 && !cards.some((c) => c.rarity === r)),
      )
    )
      errors.push("Pack rarity lacks inventory");
  }
  return errors;
}
export async function engagement(c, member, spike = false) {
  const found = await c.query(
    "SELECT id FROM cards WHERE faze_member=$1 ORDER BY id FOR UPDATE",
    [member],
  );
  if (!found.rowCount) throw Error("No cards for member");
  await c.query(
    "INSERT INTO engagement_events (faze_member,metric,value,simulated) VALUES ($1,'views',$2,true)",
    [member, spike ? randomInt(10000, 20001) : randomInt(100, 1001)],
  );
  await c.query(
    `INSERT INTO card_stats(card_id,hype,updated_at) SELECT id,$2,now() FROM cards WHERE faze_member=$1 ON CONFLICT(card_id) DO UPDATE SET hype=LEAST(100,card_stats.hype+$2),updated_at=now()`,
    [member, spike ? 25 : 1],
  );
}
export async function moderatePending(c, id) {
  const r = id
    ? await c.query(
        "SELECT * FROM submissions WHERE id=$1 AND status='pending' FOR UPDATE",
        [id],
      )
    : await c.query(
        "SELECT * FROM submissions WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED",
      );
  for (const row of r.rows)
    await c.query(
      "UPDATE submissions SET auto_flags=$2 WHERE id=$1 AND status='pending'",
      [row.id, moderationFlags(row)],
    );
}
export async function processOne(pool) {
  const c = await pool.connect();
  let job;
  try {
    await c.query("BEGIN");
    const r = await c.query(
      "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    job = r.rows[0];
    if (!job) {
      await c.query("COMMIT");
      return false;
    }
    await c.query(
      "UPDATE jobs SET status='running',updated_at=now() WHERE id=$1",
      [job.id],
    );
    // Savepoint preserves the claimed row lock while rolling back partial job writes.
    await c.query("SAVEPOINT job_effects");
    try {
      if (job.kind === "engagement_spike")
        await engagement(c, job.payload.fazeMember, true);
      else if (job.kind === "moderate")
        await moderatePending(c, job.payload.submissionId);
      else if (job.kind === "publish_set") {
        const id = job.payload.setId;
        const set = await c.query(
          "SELECT id FROM card_sets WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!set.rowCount) throw Error("Set not found");
        const cards = await c.query(
          "SELECT art_url,rarity FROM cards WHERE set_id=$1",
          [id],
        );
        const packs = await c.query(
          "SELECT odds FROM packs WHERE set_id=$1 AND active",
          [id],
        );
        const errors = publishingErrors(cards.rows, packs.rows);
        if (errors.length) throw Error(errors.join("; "));
        await c.query(
          "UPDATE card_sets SET status='live',published_at=COALESCE(published_at,now()) WHERE id=$1",
          [id],
        );
      } else throw Error("Unknown job kind");
      await c.query(
        "UPDATE jobs SET status='done',error=NULL,updated_at=now() WHERE id=$1",
        [job.id],
      );
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT job_effects");
      await c.query(
        "UPDATE jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1",
        [job.id, String(e.message).slice(0, 1000)],
      );
    }
    await c.query("COMMIT");
    return true;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export async function tick(pool, simulate) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await moderatePending(c);
    if (simulate) {
      // Serialize interval writers across worker processes; no extra schema required.
      const lock = await c.query(
        "SELECT pg_try_advisory_xact_lock(846273) AS locked",
      );
      if (lock.rows[0].locked) {
        const members = await c.query(
          "SELECT DISTINCT faze_member FROM cards ORDER BY faze_member",
        );
        for (const row of members.rows) await engagement(c, row.faze_member);
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
