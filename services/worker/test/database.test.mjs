import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { processOne, tick } from "../src/jobs.mjs";
const url = process.env.TEST_DATABASE_URL;
test(
  "database worker persists spikes, flags, publishing and safe job failures",
  { skip: !url },
  async () => {
    if (url === process.env.DATABASE_URL)
      throw Error("TEST_DATABASE_URL must differ from DATABASE_URL");
    const schema = "worker_test_" + randomUUID().replaceAll("-", "");
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    let pool;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new pg.Pool({
        connectionString: url,
        max: 4,
        options: `-c search_path=${schema},public`,
      });
      await pool.query(
        await readFile(
          new URL("../../api/migrations/001_init.sql", import.meta.url),
          "utf8",
        ),
      );
      const set = (
        await pool.query(
          "INSERT INTO card_sets(name) VALUES ('Demo') RETURNING id",
        )
      ).rows[0].id;
      const card = (
        await pool.query(
          "INSERT INTO cards(set_id,name,faze_member,rarity,art_url,base_power,demo) VALUES ($1,'Demo','FaZe Banks','common','/demo.svg',20,true) RETURNING id",
          [set],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO packs(set_id,name,price_coins,cards_per_pack,odds) VALUES ($1,'Demo',100,5,'{\"common\":100}')",
        [set],
      );
      const user = (
        await pool.query(
          "INSERT INTO users(email,password_hash,display_name) VALUES ('worker@test.faze','x','SHIT') RETURNING id",
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO submissions(user_id,kind,payload) VALUES ($1,'display_name','{\"displayName\":\"SHIT\"}')",
        [user],
      );
      // Previously the oldest 100 pending rows were re-scanned forever, starving later rows.
      await pool.query(
        "INSERT INTO submissions(user_id,kind,payload) SELECT $1,'display_name',jsonb_build_object('displayName','SHIT') FROM generate_series(1,150)",
        [user],
      );
      await pool.query(
        "INSERT INTO jobs(kind,payload) VALUES ('engagement_spike','{\"fazeMember\":\"FaZe Banks\"}'),('publish_set',$1),('engagement_spike','{\"fazeMember\":\"Missing\"}')",
        [{ setId: set }],
      );
      await Promise.all([processOne(pool), processOne(pool)]);
      await processOne(pool);
      await tick(pool, false);
      assert.equal(
        (
          await pool.query("SELECT hype FROM card_stats WHERE card_id=$1", [
            card,
          ])
        ).rows[0].hype,
        25,
      );
      assert.equal(
        (await pool.query("SELECT simulated FROM engagement_events")).rows[0]
          .simulated,
        true,
      );
      assert.equal(
        (await pool.query("SELECT status FROM card_sets WHERE id=$1", [set]))
          .rows[0].status,
        "live",
      );
      const sub = (
        await pool.query("SELECT status,auto_flags FROM submissions")
      ).rows[0];
      assert.equal(sub.status, "pending");
      assert.deepEqual(sub.auto_flags, ["profanity"]);
      const scanned = (await pool.query("SELECT count(*)::int AS count FROM submissions WHERE status='pending' AND auto_flags=ARRAY['profanity']::text[]")).rows[0].count;
      assert.equal(scanned, 151, 'all pending rows including those beyond 100 receive automatic checks');
      const jobs = (await pool.query("SELECT status FROM jobs")).rows;
      assert.equal(jobs.filter((j) => j.status === "done").length, 2);
      assert.equal(jobs.filter((j) => j.status === "failed").length, 1);
    } finally {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  },
);
