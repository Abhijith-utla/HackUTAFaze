import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "../auth.js";
import { config } from "../config.js";
import { fail } from "../errors.js";

import { tx } from "../db.js";
import { toSubmission } from "../mappers.js";

const LIMIT = 2 * 1024 * 1024;
const MAX_BASE64 = 4 * Math.ceil(LIMIT / 3);
const Body = z.object({ base64: z.string().max(MAX_BASE64), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).strict();
const types = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

export function decodeArt(body: unknown): { bytes: Buffer; extension: keyof typeof types } {
  const { base64, mimeType } = Body.parse(body);
  if (!base64.length || base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail("VALIDATION", "Invalid base64 image");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > LIMIT || !bytes.length || bytes.toString("base64") !== base64) fail("VALIDATION", "Image must be at most 2MB with canonical base64");
  let extension: keyof typeof types;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12,16).toString() === "IHDR") extension = "png";
  else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length-2] === 255 && bytes[bytes.length-1] === 217) extension = "jpg";
  else if (bytes.length >= 16 && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii",12,16))) extension = "webp";
  else return fail("VALIDATION", "Image signature is not PNG, JPEG or WebP");
  if (types[extension] !== mimeType) fail("VALIDATION", "Image content does not match MIME type");
  return { bytes, extension };
}

export async function artRoutes(app: FastifyInstance, uploadDir = config.uploadDir) {
  app.post("/admin/art", { bodyLimit: MAX_BASE64 + 1024 }, async (req, reply) => {
    requireAdmin(req);
    const input = req.body as Record<string, unknown>;
    const legacy = input && 'dataBase64' in input;
    const { bytes, extension } = decodeArt(legacy ? { base64: input.dataBase64, mimeType: input.contentType } : req.body);
    await mkdir(uploadDir, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(path.join(uploadDir, filename), bytes, { flag: "wx" });
    const origin = (process.env.PUBLIC_API_URL || process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
    return reply.code(201).send({ artUrl: legacy ? origin + '/art/' + filename : '/uploaded-art/' + filename });
  });
  app.post("/submissions/fan-art", { bodyLimit: MAX_BASE64 + 2048 }, async (req, reply) => {
    const user = requireUser(req);
    const body = z.object({ name: z.string().trim().min(1).max(80), base64: z.string().max(MAX_BASE64), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).strict().parse(req.body);
    decodeArt({ base64: body.base64, mimeType: body.mimeType });
    const submission = await tx(async c => {
      const result = await c.query("INSERT INTO submissions(user_id,kind,payload,status) VALUES($1,'fan_art',$2,'pending') RETURNING *", [user.sub, { name: body.name, imageData: 'data:' + body.mimeType + ';base64,' + body.base64 }]);
      await c.query("INSERT INTO jobs(kind,payload) VALUES('moderate',$1)", [{ submissionId: result.rows[0].id }]);
      return result.rows[0];
    });
    return reply.code(201).send({ submission: toSubmission(submission) });
  });
  for (const route of ["/uploaded-art/:file", "/art/:file"]) app.get<{ Params: { file: string } }>(route, async (req, reply) => {
    const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(png|jpg|webp)$/i.exec(req.params.file);
    if (!match) return fail("NOT_FOUND", "Image not found");
    try {
      const bytes = await readFile(path.join(uploadDir, req.params.file));
      return reply.type(types[match[2]!.toLowerCase() as keyof typeof types]).header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "default-src 'none'; sandbox").send(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("NOT_FOUND", "Image not found");
      throw error;
    }
  });
}
