import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadPublicArt, mimeForExt, storeArt, storeFanArt, type Queryable } from "../art-store.js";
import { requireAdmin, requireUser } from "../auth.js";
import { config } from "../config.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { toSubmission } from "../mappers.js";

const LIMIT = 2 * 1024 * 1024;
const MAX_BASE64 = 4 * Math.ceil(LIMIT / 3);
const Body = z.object({ base64: z.string().max(MAX_BASE64), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).strict();
const types = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
const UUID = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\.([a-z]+))?$/i;
const LEGACY_FILE = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(png|jpg|webp)$/i;

/** Validates uploads: canonical base64, ≤ 2MB, PNG/JPEG/WebP magic bytes matching the claimed MIME. Never SVG. */
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

/**
 * v1.5: uploads and fan art are stored in card_art; artUrl is relative (`/art/<id>.<ext>`).
 * `uploadDir` serves pre-v1.5 disk uploads (`/uploaded-art/…` and legacy `/art/<uuid>.<ext>`).
 * `db` is injectable so unit tests can run without Postgres.
 */
// In-memory LRU of resized art so a grid of cards hits the database and sharp once per size, not on every load.
const THUMBS = new Map<string, Buffer>();
const THUMB_MAX = 300;
async function thumbnail(id: string, w: number, bytes: Buffer): Promise<Buffer | null> {
  const key = `${id}:${w}`;
  const hit = THUMBS.get(key);
  if (hit) { THUMBS.delete(key); THUMBS.set(key, hit); return hit; }
  try {
    const { loadSharp } = await import("../pipeline/deps.js");
    const sharp = await loadSharp();
    const out: Buffer = await sharp(bytes).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78, effort: 3 }).toBuffer();
    THUMBS.set(key, out);
    if (THUMBS.size > THUMB_MAX) THUMBS.delete(THUMBS.keys().next().value as string);
    return out;
  } catch { return null; }
}

export async function artRoutes(app: FastifyInstance, uploadDir = config.uploadDir, db: Queryable = pool) {
  app.post("/admin/art", { bodyLimit: MAX_BASE64 + 1024 }, async (req, reply) => {
    requireAdmin(req);
    const input = req.body as Record<string, unknown>;
    const legacy = input && "dataBase64" in input;
    const { bytes, extension } = decodeArt(legacy ? { base64: input.dataBase64, mimeType: input.contentType } : req.body);
    const { url } = await storeArt(db, { mime: types[extension], bytes });
    return reply.code(201).send({ artUrl: url });
  });

  app.post("/submissions/fan-art", { bodyLimit: MAX_BASE64 + 2048 }, async (req, reply) => {
    const user = requireUser(req);
    const body = z.object({ name: z.string().trim().min(1).max(80), base64: z.string().max(MAX_BASE64), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]) }).strict().parse(req.body);
    const { bytes, extension } = decodeArt({ base64: body.base64, mimeType: body.mimeType });
    const submission = await tx(async (c) => {
      // Bytes go to card_art but stay private (GET /art withholds them) until the submission is approved.
      // imageData stays in the private moderation payload: D's worker inspects it for auto_flags.
      const { id: artId } = await storeFanArt(c, { mime: types[extension], bytes });
      const result = await c.query("INSERT INTO submissions(user_id,kind,payload,status) VALUES($1,'fan_art',$2,'pending') RETURNING *", [
        user.sub,
        { name: body.name, artId, imageData: "data:" + body.mimeType + ";base64," + body.base64 },
      ]);
      await c.query("INSERT INTO jobs(kind,payload) VALUES('moderate',$1)", [{ submissionId: result.rows[0].id }]);
      return result.rows[0];
    });
    return reply.code(201).send({ submission: toSubmission(submission) });
  });

  const serveLegacyFile = async (file: string, reply: import("fastify").FastifyReply) => {
    const match = LEGACY_FILE.exec(file);
    if (!match) return fail("NOT_FOUND", "Image not found");
    try {
      const bytes = await readFile(path.join(uploadDir, file));
      return reply.type(types[match[2]!.toLowerCase() as keyof typeof types]).header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "default-src 'none'; sandbox").send(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("NOT_FOUND", "Image not found");
      throw error;
    }
  };

  app.get<{ Params: { file: string } }>("/uploaded-art/:file", async (req, reply) => serveLegacyFile(req.params.file, reply));

  app.get<{ Params: { id: string } }>("/art/:id", async (req, reply) => {
    const m = UUID.exec(req.params.id);
    if (!m) return fail("NOT_FOUND", "Image not found");
    const art = await loadPublicArt(db, m[1]!.toLowerCase());
    if (!art) return serveLegacyFile(req.params.id, reply); // pre-v1.5 disk upload, else 404
    if (m[2] && mimeForExt(m[2]) !== art.mime) return fail("NOT_FOUND", "Image not found");
    // ?w=<64..1200>: a resized WebP for grids (full-size card art is ~600 KB). SVG and failures fall back to the original.
    const w = Number((req.query as { w?: string }).w);
    if (Number.isInteger(w) && w >= 64 && w <= 1200 && art.mime !== "image/svg+xml") {
      const thumb = await thumbnail(m[1]!.toLowerCase(), w, art.bytes);
      if (thumb) {
        return reply.type("image/webp").header("X-Content-Type-Options", "nosniff")
          .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
          .header("Cache-Control", "public, max-age=31536000, immutable").send(thumb);
      }
    }
    return reply
      .type(art.mime)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(art.bytes);
  });
}
