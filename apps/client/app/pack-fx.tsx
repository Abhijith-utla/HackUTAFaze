'use client';
// Reveal effects for pack opening. Visual only: every card shown here came from the server pull.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Rarity } from '@faze/shared';

export const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
export type GlitchLevel = 'epic' | 'legendary';
export const glitchLevel = (rarity: Rarity): GlitchLevel | null => rarity === 'legendary' || rarity === 'epic' ? rarity : null;

/** Delay until the card face passes 90deg in the flip, then the glitch length. Mirrors --fx-gd / --fx-gt in pack-fx.css. */
const GLITCH = { epic: { delay: 280, length: 350 }, legendary: { delay: 420, length: 700 } } as const;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Full-screen glitch layers (flash, scanlines, jumping bands). Unmounts itself via onDone; never blocks input. */
export function GlitchOverlay({ level, onDone }: { level: GlitchLevel; onDone: () => void }) {
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    const { delay, length } = GLITCH[level];
    const timer = setTimeout(() => done.current(), reducedMotion() ? 1000 : delay + length);
    return () => clearTimeout(timer);
  }, [level]);
  return <div className={`fx-glitch fx-glitch-${level}`} aria-hidden="true">
    <span className="fx-glitch-calm" />
    <span className="fx-glitch-flash" />
    <span className="fx-glitch-scan" />
    <span className="fx-glitch-bands"><i /><i /><i /><i /><i /></span>
  </div>;
}

/** Red/cyan copies of the card art, band-clipped and offset, laid exactly over the flipper. */
export function GlitchGhosts({ src }: { src: string }) {
  return <span className="fx-ghosts" aria-hidden="true">
    <span className="fx-ghost fx-ghost-r"><img src={src} alt="" /></span>
    <span className="fx-ghost fx-ghost-c"><img src={src} alt="" /></span>
  </span>;
}

/** Pointer-follow spotlight: writes --mx/--my straight to the element, no React state per frame. */
export function trackSpotlight(event: PointerEvent<HTMLElement>) {
  const el = event.currentTarget, box = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
  el.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
}

const GLYPHS = 'ΛΞΣ#%&@$▓▒░<>/\\01';
/** Legendary name scrambles through glyphs, resolving left to right. Plays once per mount; skipped under reduced motion. */
export function DecodeText({ text, play }: { text: string; play: boolean }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (!play || reducedMotion()) { setShown(text); return; }
    const start = performance.now(), hold = GLITCH.legendary.delay, resolve = 400;
    const tick = () => {
      const t = performance.now() - start;
      const fixed = t < hold ? 0 : Math.floor(((t - hold) / resolve) * text.length);
      setShown(text.split('').map((ch, n) => n < fixed || ch === ' ' ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join(''));
      if (fixed >= text.length) clearInterval(timer);
    };
    const timer = setInterval(tick, 45);
    tick();
    return () => { clearInterval(timer); setShown(text); };
  }, [text, play]);
  return <><span className="fx-sr">{text}</span><span aria-hidden="true">{shown}</span></>;
}
