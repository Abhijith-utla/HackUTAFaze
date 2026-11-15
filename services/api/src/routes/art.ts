// Contract v1.3: admin art upload + public art route. Files live on disk under ART_DIR with
// server-generated names; content type comes from the verified file signature, never from the client.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { config } from "../config.js";
import { fail } from "../errors.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_B64 = Math.ceil(MAX_BYTES / 3) * 4;

const TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
type Ext = keyof typeof TYPES;

const ArtBody = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().min(1).max(MAX_B64 + 4),
});

function sniff(b: Buffer): Ext | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function decodeArt(body: unknown): { bytes: Buffer; ext: Ext } {
  const b = ArtBody.parse(body);
  const b64 = b.dataBase64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) fail("VALIDATION", "dataBase64 is not valid base64");
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) fail("VALIDATION", "Empty image");
  if (bytes.length > MAX_BYTES) fail("VALIDATION", "Image must be at most 2 MB");
  const ext = sniff(bytes) ?? fail("VALIDATION", "Only PNG, JPEG or WebP images are accepted");
  if (TYPES[ext] !== b.contentType) fail("VALIDATION", `File content is ${TYPES[ext]}, not ${b.contentType}`);
  return { bytes, ext };
}

const FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export async function artRoutes(app: FastifyInstance) {
  app.post("/admin/art", { bodyLimit: MAX_B64 + 64 * 1024 }, async (req, reply) => {
    requireAdmin(req);
    const { bytes, ext } = decodeArt(req.body);
    await mkdir(config.artDir, { recursive: true });
    const file = `${randomUUID()}.${ext}`;
    await writeFile(path.join(config.artDir, file), bytes, { flag: "wx" });
    return reply.status(201).send({ artUrl: `${config.publicUrl}/art/${file}` });
  });

  app.get<{ Params: { file: string } }>("/art/:file", async (req, reply) => {
    const m = FILE_RE.exec(req.params.file);
    if (!m) fail("NOT_FOUND", "Image not found");
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(config.artDir, req.params.file));
    } catch {
      return fail("NOT_FOUND", "Image not found");
    }
    return reply
      .type(TYPES[m[1] as Ext])
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(bytes);
  });
}
