import { afterAll, beforeAll, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artRoutes, decodeArt } from "../src/routes/art.js";
import { artExt, relativeArtUrl } from "../src/art-store.js";
import { signSession } from "../src/auth.js";
import { registerErrorHandler } from "../src/errors.js";
const app = Fastify();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9sAAAAASUVORK5CYII=";
const body = { base64: png, mimeType: "image/png" };
const admin = { cookie: `session=${signSession("11111111-1111-4111-8111-111111111111", "admin")}` };
let folder: string;
// In-memory stand-in for card_art so this file runs without Postgres (vitest.unit.config.ts).
const store = new Map<string, { mime: string; bytes: Buffer; demo: boolean }>();
const fakeDb = {
  async query(text: string, params: unknown[] = []) {
    if (text.startsWith("INSERT INTO card_art")) {
      const id = randomUUID();
      store.set(id, { mime: params[0] as string, bytes: params[1] as Buffer, demo: params[3] as boolean });
      return { rows: [{ id }] };
    }
    if (text.includes("SELECT a.mime, a.bytes")) { const a = store.get(params[0] as string); return { rows: a ? [a] : [] }; }
    return { rows: [] }; // dedupe lookup: nothing to reuse
  },
};
beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "faze-art-"));
  await app.register(cookie); registerErrorHandler(app); await artRoutes(app, folder, fakeDb); await app.ready();
});
afterAll(async () => { await app.close(); await rm(folder, { recursive: true }); });
it("requires admin authentication", async () => {
  expect((await app.inject({ method: "POST", url: "/admin/art", payload: body })).statusCode).toBe(401);
  const fan = { cookie: `session=${signSession("11111111-1111-4111-8111-111111111111", "fan")}` };
  expect((await app.inject({ method: "POST", url: "/admin/art", headers: fan, payload: body })).statusCode).toBe(403);
});
it("checks magic bytes, MIME, strict base64, and 2MB decoded size", async () => {
  for (const payload of [{ ...body, base64: Buffer.from("<svg/>").toString("base64") }, { ...body, mimeType: "image/jpeg" }, { ...body, base64: "bad!" }, { ...body, base64: Buffer.alloc(2*1024*1024+1).toString("base64") }]) {
    const res = await app.inject({ method: "POST", url: "/admin/art", headers: admin, payload });
    expect(res.statusCode).toBe(400);
  }
  expect(() => decodeArt({ ...body, mimeType: "image/svg+xml" })).toThrow();
});
it("stores uploads in card_art and returns a relative /art/<id>.<ext> URL", async () => {
  const res = await app.inject({ method: "POST", url: "/admin/art", headers: admin, payload: body });
  expect(res.statusCode).toBe(201);
  expect(res.json().artUrl).toMatch(/^\/art\/[a-f0-9-]{36}\.png$/);
  expect(store.size).toBe(1);
  expect([...store.values()][0]).toMatchObject({ mime: "image/png", demo: false });
  const get = await app.inject(res.json().artUrl);
  expect(get.statusCode).toBe(200);
  expect(get.headers["content-type"]).toBe("image/png");
  expect(get.headers["x-content-type-options"]).toBe("nosniff");
  expect(String(get.headers["content-security-policy"])).toContain("sandbox");
  expect(get.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(get.rawPayload).toEqual(Buffer.from(png,"base64"));
  expect((await app.inject(res.json().artUrl.replace(".png", ".webp"))).statusCode).toBe(404);
});
it("falls back to pre-v1.5 disk uploads for /art and /uploaded-art", async () => {
  const name = "abcdef01-2345-4678-89ab-cdef01234567.png";
  await writeFile(path.join(folder, name), Buffer.from(png, "base64"));
  for (const url of [`/art/${name}`, `/uploaded-art/${name}`]) {
    const get = await app.inject(url);
    expect(get.statusCode, url).toBe(200);
    expect(get.headers["content-type"]).toBe("image/png");
    expect(get.headers["x-content-type-options"]).toBe("nosniff");
  }
  for (const url of ["/art/not-a-uuid.png", "/art/..%2Fpackage.json", "/uploaded-art/invalid.png", "/art/00000000-0000-4000-8000-000000000000.png"]) {
    expect((await app.inject(url)).statusCode, url).toBe(404);
  }
});
it("relativeArtUrl strips this API's own host only", () => {
  expect(relativeArtUrl("http://localhost:4000/art/x.png")).toBe("/art/x.png");
  expect(relativeArtUrl("http://127.0.0.1:4000/demo-art/x.svg")).toBe("/demo-art/x.svg");
  expect(relativeArtUrl("/uploaded-art/x.png")).toBe("/uploaded-art/x.png");
  expect(relativeArtUrl("https://placehold.co/400x560?text=a")).toBe("https://placehold.co/400x560?text=a");
  expect(relativeArtUrl("https://cdn.example.com/art/x.png")).toBe("https://cdn.example.com/art/x.png");
});
it("artExt maps the four stored mimes", () => {
  expect(["image/png", "image/jpeg", "image/webp", "image/svg+xml"].map(artExt)).toEqual(["png", "jpg", "webp", "svg"]);
  expect(() => artExt("text/html")).toThrow();
});
