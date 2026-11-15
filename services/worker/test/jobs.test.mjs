import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { moderationFlags, publishingErrors, processOne } from "../src/jobs.mjs";
test("moderation flags profanity without making approval decisions", () => {
  assert.deepEqual(
    moderationFlags({
      kind: "display_name",
      payload: { displayName: "Friendly fan" },
    }),
    [],
  );
  assert.deepEqual(
    moderationFlags({ kind: "trade_message", payload: { message: "SHIT!" } }),
    ["profanity"],
  );
});
test("fan art requires inspectable bytes and rejects MIME spoofing", () => {
  assert.deepEqual(
    moderationFlags({
      kind: "fan_art",
      payload: {
        artUrl: "https://example.test/img.png",
        mimeType: "image/png",
      },
    }),
    ["image_unverified"],
  );
  assert.deepEqual(
    moderationFlags({
      kind: "fan_art",
      payload: { imageData: "data:image/png;base64,aGVsbG8=" },
    }),
    ["image_type"],
  );
});
test("publishing requires art, active pack, valid odds and rarity inventory", () => {
  assert.ok(publishingErrors([], []).length);
  assert.ok(
    publishingErrors(
      [{ art_url: "", rarity: "common" }],
      [{ odds: { common: 100 } }],
    ).length,
  );
  assert.ok(
    publishingErrors(
      [{ art_url: "x", rarity: "common" }],
      [{ odds: { common: 90 } }],
    ).length,
  );
  assert.ok(
    publishingErrors(
      [{ art_url: "x", rarity: "common" }],
      [{ odds: { rare: 100 } }],
    ).length,
  );
  assert.deepEqual(
    publishingErrors(
      [{ art_url: "x", rarity: "common" }],
      [{ odds: { common: 100 } }],
    ),
    [],
  );
});
test("generated catalog has 40 original art files and publishable sets", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL("../../../content/seed/catalog.json", import.meta.url),
    ),
  );
  assert.equal(catalog.cards.length, 40);
  assert.equal(catalog.sets.length, 3);
  for (const card of catalog.cards) {
    assert.equal(card.demo, true);
    assert.match(
      await readFile(
        new URL(`../../../content/seed/art/${card.id}.svg`, import.meta.url),
        "utf8",
      ),
      /ORIGINAL GEOMETRIC/,
    );
  }
  for (const set of catalog.sets)
    assert.deepEqual(
      publishingErrors(
        catalog.cards
          .filter((c) => c.setId === set.id)
          .map((c) => ({ art_url: c.artUrl, rarity: c.rarity })),
        catalog.packs.filter((p) => p.setId === set.id),
      ),
      [],
    );
});
test("a failing job rolls back effects while marking durable failure under its lock", async () => {
  const calls = [];
  const c = {
    query: async (sql, args) => {
      calls.push(sql);
      if (sql.startsWith("SELECT * FROM jobs"))
        return { rows: [{ id: "j", kind: "unknown", payload: {} }] };
      return { rows: [] };
    },
    release() {
      calls.push("release");
    },
  };
  assert.equal(await processOne({ connect: async () => c }), true);
  assert.ok(calls.includes("ROLLBACK TO SAVEPOINT job_effects"));
  assert.ok(calls.some((q) => q.includes("status='failed'")));
  assert.equal(calls.at(-2), "COMMIT");
});
