import { afterAll, beforeAll, expect, it } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artRoutes, decodeArt } from "../src/routes/art.js";
import { signSession } from "../src/auth.js";
import { registerErrorHandler } from "../src/errors.js";
const app = Fastify();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9sAAAAASUVORK5CYII=";
const body = { base64: png, mimeType: "image/png" };
const admin = { cookie: `session=${signSession("11111111-1111-4111-8111-111111111111", "admin")}` };
let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "faze-art-"));
  await app.register(cookie); registerErrorHandler(app); await artRoutes(app, folder); await app.ready();
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
it("stores original bytes under an opaque filename and serves safe MIME", async () => {
  const res = await app.inject({ method: "POST", url: "/admin/art", headers: admin, payload: body });
  expect(res.statusCode).toBe(201);
  expect(res.json().artUrl).toMatch(/^https?:\/\/[^/]+\/uploaded-art\/[a-f0-9-]{36}\.png$/);
  const get = await app.inject(new URL(res.json().artUrl).pathname);
  expect(get.statusCode).toBe(200);
  expect(get.headers["content-type"]).toBe("image/png");
  expect(get.headers["x-content-type-options"]).toBe("nosniff");
  expect(get.rawPayload).toEqual(Buffer.from(png,"base64"));
  expect((await app.inject("/uploaded-art/invalid.png")).statusCode).toBe(404);
});
