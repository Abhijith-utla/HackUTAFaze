/**
 * Frame capture for Clip Lab. The Twitch player is a cross-origin iframe, so its pixels can't be read
 * directly: we ask for a one-frame capture of THIS tab (getDisplayMedia), crop it to the player's
 * on-screen rect, and stop every track immediately.
 */

export type Frame = { dataUrl: string; width: number; height: number };
export const MAX_FRAME_WIDTH = 1920;

export const canCaptureTab = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';

function toPng(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Frame {
  const scale = sw > MAX_FRAME_WIDTH ? MAX_FRAME_WIDTH / sw : 1;
  const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

async function grabFrame(track: MediaStreamTrack, stream: MediaStream): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture;
  if (IC) {
    try {
      const bmp = await new IC(track).grabFrame();
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* fall through to <video> */ }
  }
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();
  await new Promise<void>(resolve => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => resolve());
    else setTimeout(resolve, 120);
  });
  return { img: video, w: video.videoWidth, h: video.videoHeight, close: () => { video.pause(); video.srcObject = null; } };
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Captures one frame of the current tab and crops it to `el`. `onGrab` runs right at grab time (for timestamps). */
export async function captureElement(el: HTMLElement, onGrab: () => void): Promise<Frame & { cropped: 'region' | 'rect' | 'none' }> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' }, preferCurrentTab: true, selfBrowserSurface: 'include', audio: false,
    } as DisplayMediaStreamOptions);
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('No video track in the capture.');
    const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;

    // Chrome Region Capture: crop to the element server-side when we captured this very tab.
    let region = false;
    const CT = (window as unknown as { CropTarget?: { fromElement(e: Element): Promise<unknown> } }).CropTarget;
    const cropTo = (track as MediaStreamTrack & { cropTo?: (t: unknown) => Promise<void> }).cropTo;
    if (CT && cropTo && surface === 'browser') {
      try { await cropTo.call(track, await CT.fromElement(el)); region = true; } catch { region = false; }
    }
    // A tab capture only contains what's on screen: bring the whole player into view first.
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > window.innerHeight) el.scrollIntoView({ block: r0.height > window.innerHeight ? 'start' : 'center', behavior: 'instant' as ScrollBehavior });
    await wait(region ? 250 : 400);  // let the "sharing this tab" bar and scroll settle so the viewport is final

    const rect = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    onGrab();
    const f = await grabFrame(track, stream);
    try {
      if (region) return { ...toPng(f.img, 0, 0, f.w, f.h), cropped: 'region' };
      if (surface && surface !== 'browser') return { ...toPng(f.img, 0, 0, f.w, f.h), cropped: 'none' };
      // Frame pixels per CSS px (= devicePixelRatio unless the browser scaled the capture). Rect is viewport-relative,
      // which is exactly what a tab capture shows, so scroll is already accounted for.
      const sx = f.w / vw, sy = f.h / vh;
      const x = Math.max(0, rect.left * sx), y = Math.max(0, rect.top * sy);
      const w = Math.min(f.w - x, rect.width * sx), h = Math.min(f.h - y, rect.height * sy);
      if (w < 8 || h < 8) return { ...toPng(f.img, 0, 0, f.w, f.h), cropped: 'none' };
      return { ...toPng(f.img, x, y, w, h), cropped: 'rect' };
    } finally { f.close(); }
  } finally {
    stream?.getTracks().forEach(t => t.stop());
  }
}

export async function frameFromFile(file: File): Promise<Frame> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG or JPG).');
  const bmp = await createImageBitmap(file);
  try { return toPng(bmp, 0, 0, bmp.width, bmp.height); } finally { bmp.close(); }
}
