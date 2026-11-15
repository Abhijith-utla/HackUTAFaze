import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeAdmin, makeApp, pool, signup } from "./helpers.js";

// 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9sAAAAASUVORK5CYII=";

let app: FastifyInstance;
let admin: { cookie: string };
beforeAll(async () => {
  app = await makeApp();
  admin = await makeAdmin();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const upload = (payload: unknown, cookie = admin.cookie) =>
  app.inject({ method: "POST", url: "/admin/art", headers: { cookie }, payload: payload as object });

describe("art upload (v1.3)", () => {
  it("admin uploads a PNG and anyone can fetch it with nosniff", async () => {
    const res = await upload({ filename: "../../evil.png", contentType: "image/png", dataBase64: PNG });
    expect(res.statusCode).toBe(201);
    const url = new URL(res.json().artUrl, "http://api.test");
    expect(res.json().artUrl).toBe(url.pathname); // v1.5: relative
    expect(url.pathname).toMatch(/^\/art\/[0-9a-f-]{36}\.png$/); // client filename ignored
    const got = await app.inject({ method: "GET", url: url.pathname });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.rawPayload.equals(Buffer.from(PNG, "base64"))).toBe(true);
  });

  it("fans are forbidden, anonymous is unauthenticated", async () => {
    const fan = await signup(app);
    expect((await upload({ filename: "a.png", contentType: "image/png", dataBase64: PNG }, fan.cookie)).statusCode).toBe(403);
    expect((await upload({ filename: "a.png", contentType: "image/png", dataBase64: PNG }, "")).statusCode).toBe(401);
  });

  it("rejects SVG, mismatched type, junk base64 and >2 MB", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    const bad = [
      { filename: "x.svg", contentType: "image/svg+xml", dataBase64: svg },
      { filename: "x.png", contentType: "image/png", dataBase64: svg },
      { filename: "x.jpg", contentType: "image/jpeg", dataBase64: PNG },
      { filename: "x.png", contentType: "image/png", dataBase64: "!!!notbase64!!!" },
    ];
    for (const p of bad) {
      const r = await upload(p);
      expect(r.statusCode, JSON.stringify(p).slice(0, 60)).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION");
    }
    const big = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(2 * 1024 * 1024)]).toString("base64");
    const r = await upload({ filename: "big.png", contentType: "image/png", dataBase64: big });
    expect(r.statusCode).toBe(400);
  });

  it("GET /art only serves server-generated names", async () => {
    for (const f of ["..%2F..%2Fpackage.json", "package.json", "00000000-0000-0000-0000-000000000000.png"]) {
      expect((await app.inject({ method: "GET", url: `/art/${f}` })).statusCode).toBe(404);
    }
  });
});

describe("card_art (v1.5)", () => {
  it("stores uploads in the DB, dedupes identical bytes, serves immutable", async () => {
    const a = (await upload({ base64: PNG, mimeType: "image/png" })).json().artUrl as string;
    const b = (await upload({ filename: "again.png", contentType: "image/png", dataBase64: PNG })).json().artUrl as string;
    expect(a).toMatch(/^\/art\/[0-9a-f-]{36}\.png$/);
    expect(b).toBe(a);
    const id = a.slice(5, 41);
    const row = await pool.query("SELECT mime, octet_length(bytes) AS n, sha256, demo FROM card_art WHERE id=$1", [id]);
    expect(row.rows[0]).toMatchObject({ mime: "image/png", n: Buffer.from(PNG, "base64").length, demo: false });
    for (const url of [a, `/art/${id}`]) {
      const got = await app.inject(url);
      expect(got.statusCode, url).toBe(200);
      expect(got.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(String(got.headers["content-security-policy"])).toContain("sandbox");
    }
    expect((await app.inject(`/art/${id}.jpg`)).statusCode).toBe(404);
  });

  it("card create/update store relative art paths", async () => {
    const set = await pool.query("INSERT INTO card_sets (name, demo) VALUES ($1, true) RETURNING id", [`Art ${Date.now()}`]);
    const created = await app.inject({
      method: "POST", url: "/admin/cards", headers: { cookie: admin.cookie },
      payload: { setId: set.rows[0].id, name: "X", fazeMember: "Rug", rarity: "common", artUrl: "http://localhost:4000/art/abc.png" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().card.artUrl).toBe("/art/abc.png");
    const patched = await app.inject({
      method: "PATCH", url: `/admin/cards/${created.json().card.id}`, headers: { cookie: admin.cookie },
      payload: { artUrl: "https://placehold.co/400x560" },
    });
    expect(patched.json().card.artUrl).toBe("https://placehold.co/400x560");
  });

  it("migration 002 backfill strips own-host prefixes only", async () => {
    const sql = "SELECT regexp_replace($1::text, '^https?://[^/]+(?=/(art|uploaded-art|demo-art)/)', '') AS v";
    const cases: [string, string][] = [
      ["http://localhost:4000/demo-art/x.svg", "/demo-art/x.svg"],
      ["https://api.example:8443/uploaded-art/x.png", "/uploaded-art/x.png"],
      ["https://placehold.co/400x560?text=a", "https://placehold.co/400x560?text=a"],
    ];
    for (const [input, out] of cases) expect((await pool.query(sql, [input])).rows[0].v).toBe(out);
    expect((await pool.query("SELECT 1 FROM schema_migrations WHERE name='002_card_art.sql'")).rowCount).toBe(1);
  });
});
