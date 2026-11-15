// Face DETECTION with YuNet (OpenCV Zoo, MIT) on onnxruntime-node, CPU, fully local.
// No recognition, no embeddings. Landmarks are returned to the in-process scorer only and are
// never persisted or sent to clients.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrt, loadSharp, PipelineUnavailable } from "./deps.js";
import type { Face } from "./score.js";

const SIZE = 640; // YuNet 2023mar fixed input
const MIN_SCORE = 0.6;
const NMS_IOU = 0.3;
export const MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const MODEL_PATH = process.env.FACE_MODEL_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "models", "face_detection_yunet_2023mar.onnx");

export type Detector = (image: Buffer) => Promise<{ width: number; height: number; faces: Face[] }>;

let session: Promise<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
function getSession() {
  session ??= (async () => {
    const ort = await loadOrt();
    const bytes = await readFile(MODEL_PATH).catch(() => null);
    if (!bytes) throw new PipelineUnavailable(`Face model missing at ${MODEL_PATH}`);
    if (createHash("sha256").update(bytes).digest("hex") !== MODEL_SHA256 && !process.env.FACE_MODEL_PATH) throw new PipelineUnavailable("Face model checksum mismatch");
    return ort.InferenceSession.create(MODEL_PATH, { executionProviders: ["cpu"], intraOpNumThreads: 2 });
  })().catch((e) => {
    session = null;
    throw e;
  });
  return session;
}

const iou = (a: Face, b: Face) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** Decodes YuNet's three stride heads (mirrors OpenCV FaceDetectorYN::postProcess) + NMS. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decodeYunet(out: Record<string, { data: any }>): Face[] {
  const faces: Face[] = [];
  for (const s of [8, 16, 32]) {
    const cls = out[`cls_${s}`]!.data, obj = out[`obj_${s}`]!.data, bbox = out[`bbox_${s}`]!.data, kps = out[`kps_${s}`]!.data;
    const cols = SIZE / s;
    for (let r = 0; r < cols; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const score = Math.sqrt(Math.min(Math.max(cls[i], 0), 1) * Math.min(Math.max(obj[i], 0), 1));
        if (score < MIN_SCORE) continue;
        const cx = (c + bbox[i * 4]) * s, cy = (r + bbox[i * 4 + 1]) * s;
        const w = Math.exp(bbox[i * 4 + 2]) * s, h = Math.exp(bbox[i * 4 + 3]) * s;
        const lm: [number, number][] = [];
        for (let k = 0; k < 5; k++) lm.push([(c + kps[i * 10 + 2 * k]) * s, (r + kps[i * 10 + 2 * k + 1]) * s]);
        faces.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, lm });
      }
  }
  const keep: Face[] = [];
  for (const f of faces.sort((a, b) => b.score - a.score)) if (keep.every((k) => iou(k, f) < NMS_IOU)) keep.push(f);
  return keep;
}

/** Real detector: letterbox to 640² BGR float (YuNet takes raw 0..255 BGR), run, map back to source px. */
export const yunetDetector: Detector = async (image) => {
  const [sharp, ort, sess] = await Promise.all([loadSharp(), loadOrt(), getSession()]);
  const meta = await sharp(image).metadata();
  const width = meta.width as number, height = meta.height as number;
  const scale = Math.min(SIZE / width, SIZE / height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const data: Buffer = await sharp(image).removeAlpha().resize(w, h, { fit: "fill" })
    .extend({ right: SIZE - w, bottom: SIZE - h, background: { r: 0, g: 0, b: 0 } }).raw().toBuffer();
  const plane = SIZE * SIZE, f = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) { f[i] = data[i * 3 + 2]!; f[plane + i] = data[i * 3 + 1]!; f[2 * plane + i] = data[i * 3]!; }
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", f, [1, 3, SIZE, SIZE]) });
  const faces = decodeYunet(out).map((x) => ({
    ...x, x: x.x / scale, y: x.y / scale, w: x.w / scale, h: x.h / scale,
    lm: x.lm.map(([a, b]) => [a / scale, b / scale] as [number, number]),
  }));
  return { width, height, faces };
};

let override: Detector | null = null;
/** Test hook: replace the detector (null restores YuNet). */
export function setDetector(d: Detector | null) { override = d; }
export const detectorOverridden = () => override !== null;
export const detectFaces: Detector = (image) => (override ?? yunetDetector)(image);
