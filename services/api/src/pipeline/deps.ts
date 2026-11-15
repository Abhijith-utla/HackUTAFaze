// Lazy loaders for the pipeline's heavy optional dependencies (sharp, onnxruntime-node,
// ffmpeg-static). They are optionalDependencies of @faze/api: the API boots and every other route
// works without them; pipeline routes answer 503 PIPELINE_UNAVAILABLE instead.
// Specifiers go through a variable so typecheck does not require them to be installed.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Sharp = any; // sharp's default export (callable factory)
export type Ort = { InferenceSession: { create(path: string, opts?: object): Promise<any> }; Tensor: new (type: string, data: Float32Array, dims: number[]) => any };

export class PipelineUnavailable extends Error {}

const dynamicImport = (name: string): Promise<any> => import(name);

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= fn().catch((e) => {
      p = null; // allow a retry after `npm install`
      throw e;
    });
    return p;
  };
}

export const loadSharp = once<Sharp>(async () => {
  const m = await dynamicImport("sharp").catch(() => null);
  if (!m) throw new PipelineUnavailable("Face-art pipeline unavailable: sharp is not installed");
  return m.default ?? m;
});

export const loadOrt = once<Ort>(async () => {
  const m = await dynamicImport("onnxruntime-node").catch(() => null);
  if (!m) throw new PipelineUnavailable("Face-art pipeline unavailable: onnxruntime-node is not installed");
  return (m.default?.InferenceSession ? m.default : m) as Ort;
});

/** FFMPEG_PATH wins; else the ffmpeg-static binary. */
export const loadFfmpeg = once<string>(async () => {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const m = await dynamicImport("ffmpeg-static").catch(() => null);
  const p: string | null = m?.default ?? null;
  if (!p) throw new PipelineUnavailable("Face-art pipeline unavailable: ffmpeg-static is not installed (or set FFMPEG_PATH)");
  return p;
});
