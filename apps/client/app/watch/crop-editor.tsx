'use client';
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

/** Box in source-pixel coordinates of the captured frame. */
export type Box = { x: number; y: number; w: number; h: number };
export type Candidate = { rank: number; box: Box; scores?: Record<string, number>; previewUrl?: string };

export const CARD_RATIO = 5 / 6;   // width / height, matches the card art
const MIN = 24;

/** Clamp a 5:6 box inside a W x H frame. */
export function fitBox(b: Box, W: number, H: number): Box {
  let w = Math.max(MIN, b.w), h = w / CARD_RATIO;
  if (w > W) { w = W; h = w / CARD_RATIO; }
  if (h > H) { h = H; w = h * CARD_RATIO; }
  return { w, h, x: Math.min(Math.max(0, b.x), W - w), y: Math.min(Math.max(0, b.y), H - h) };
}
export const defaultBox = (W: number, H: number): Box => { const h = H * .8, w = h * CARD_RATIO; return fitBox({ x: (W - w) / 2, y: (H - h) / 2, w, h }, W, H); };
/** Smallest 5:6 box that contains `b` (a face box of any aspect), centered on it, with a little headroom. */
export function cardBoxAround(b: Box, W: number, H: number): Box {
  const w = Math.max(b.w, b.h * CARD_RATIO) * 1.35, h = w / CARD_RATIO;
  return fitBox({ x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }, W, H);
}
export const roundBox = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

const pct = (b: Box, W: number, H: number): CSSProperties => ({ left: `${b.x / W * 100}%`, top: `${b.y / H * 100}%`, width: `${b.w / W * 100}%`, height: `${b.h / H * 100}%` });

type Drag = { mode: 'move' | 'resize' | 'draw'; id: number; ax: number; ay: number; start: Box };

export default function CropEditor({ src, W, H, crop, onCrop, candidates, picked, onPickCandidate }: {
  src: string; W: number; H: number; crop: Box; onCrop: (b: Box) => void;
  candidates: Candidate[]; picked: number | null; onPickCandidate: (c: Candidate) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  function toSource(e: PointerEvent) {
    const r = stage.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  function begin(e: PointerEvent<HTMLElement>, mode: Drag['mode']) {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const p = toSource(e);
    drag.current = { mode, id: e.pointerId, ax: p.x, ay: p.y, start: crop };
    stage.current!.setPointerCapture(e.pointerId);
    if (mode === 'draw') onCrop(fitBox({ x: p.x, y: p.y, w: MIN, h: MIN / CARD_RATIO }, W, H));
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = toSource(e), dx = p.x - d.ax, dy = p.y - d.ay;
    if (d.mode === 'move') { onCrop(fitBox({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, W, H)); return; }
    // resize from the bottom-right handle, or draw from the anchor: keep 5:6 and grow toward the pointer
    const ox = d.mode === 'resize' ? d.start.x : d.ax, oy = d.mode === 'resize' ? d.start.y : d.ay;
    const rx = p.x - ox, ry = p.y - oy;
    let w = Math.max(MIN, Math.abs(rx), Math.abs(ry) * CARD_RATIO);
    const maxW = Math.min(rx < 0 ? ox : W - ox, (ry < 0 ? oy : H - oy) * CARD_RATIO);
    w = Math.min(w, Math.max(MIN, maxW));
    const h = w / CARD_RATIO;
    onCrop(fitBox({ x: rx < 0 ? ox - w : ox, y: ry < 0 ? oy - h : oy, w, h }, W, H));
  }
  function end(e: PointerEvent<HTMLDivElement>) { if (drag.current?.id === e.pointerId) drag.current = null; }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    const step = (e.shiftKey ? .05 : .01) * W;
    const k: Record<string, [number, number, number]> = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], '+': [0, 0, step], '=': [0, 0, step], '-': [0, 0, -step] };
    const v = k[e.key];
    if (!v) return;
    e.preventDefault();
    const w = crop.w + v[2];
    onCrop(fitBox({ x: crop.x + v[0] - v[2] / 2, y: crop.y + v[1] - v[2] / CARD_RATIO / 2, w, h: w / CARD_RATIO }, W, H));
  }

  return <div className="watch-crop" ref={stage} style={{ aspectRatio: `${W} / ${H}` }}
    onPointerDown={e => begin(e, 'draw')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    <img src={src} alt="Captured frame" draggable={false} />
    {candidates.map(c => <button key={c.rank} type="button" className={`watch-cand${picked === c.rank ? ' picked' : ''}`} style={pct(c.box, W, H)}
      onPointerDown={e => e.stopPropagation()} onClick={() => onPickCandidate(c)} aria-label={`Use face candidate ${c.rank}`}><span>#{c.rank}</span></button>)}
    <div className="watch-crop-box" style={pct(crop, W, H)} tabIndex={0} role="group"
      aria-label="Card crop, 5 by 6. Drag to move; arrow keys nudge (Shift for bigger steps); plus and minus resize."
      onPointerDown={e => begin(e, 'move')} onKeyDown={key}>
      <span className="watch-crop-handle" onPointerDown={e => begin(e, 'resize')} aria-hidden="true" />
    </div>
  </div>;
}

/** Live 5:6 preview of the crop, pure CSS (no extra canvas). */
export function CropPreview({ src, W, H, crop }: { src: string; W: number; H: number; crop: Box }) {
  const style: CSSProperties = {
    backgroundImage: `url(${src})`,
    backgroundSize: `${W / crop.w * 100}% auto`,
    backgroundPosition: `${W === crop.w ? 0 : crop.x / (W - crop.w) * 100}% ${H === crop.h ? 0 : crop.y / (H - crop.h) * 100}%`,
  };
  return <div className="watch-crop-preview" style={style} role="img" aria-label="Crop preview" />;
}
