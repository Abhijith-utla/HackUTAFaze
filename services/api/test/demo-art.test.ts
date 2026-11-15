import { afterAll, beforeAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Point DEMO_ART_DIR at a temp folder before the app (and its config) loads.
const dir = await mkdtemp(path.join(tmpdir(), "demo-art-"));
process.env.DEMO_ART_DIR = dir;
const { makeApp, pool } = await import("./helpers.js");

const ID = "d0000000-0000-4000-8000-000000001001";
let app: FastifyInstance;
beforeAll(async () => {
  await writeFile(path.join(dir, `${ID}.svg`), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});

it("serves committed demo SVG art sandboxed", async () => {
  const r = await app.inject({ method: "GET", url: `/demo-art/${ID}.svg` });
  expect(r.statusCode).toBe(200);
  expect(r.headers["content-type"]).toContain("image/svg+xml");
  expect(r.headers["x-content-type-options"]).toBe("nosniff");
  expect(String(r.headers["content-security-policy"])).toContain("sandbox");
});

it("only uuid.svg names, nothing else", async () => {
  for (const f of ["x.svg", `${ID}.png`, "..%2Fcatalog.json", "d0000000-0000-4000-8000-000000009999.svg"]) {
    expect((await app.inject({ method: "GET", url: `/demo-art/${f}` })).statusCode).toBe(404);
  }
});
