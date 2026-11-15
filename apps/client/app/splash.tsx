'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import './splash.css';

/*
 * Intro splash: grayscale field + wordmark -> red brush strokes paint in ->
 * field wipes away (clip-path) while the app beneath drains from grayscale to color.
 *
 * SSR strategy: the overlay is server-rendered and its CSS animation starts at first
 * paint, so it never waits on hydration. A tiny inline script (first child of the
 * overlay) checks sessionStorage before the rest of the page is parsed and marks the
 * overlay `data-seen`; CSS then hides it and drops the app's grayscale, so returning
 * visitors in the same session see no flash. suppressHydrationWarning on the overlay
 * covers that one attribute. After hydration React unmounts the overlay entirely.
 * Even if JS never runs, the CSS ends with the overlay hidden and pointer-events: none.
 */

const KEY = 'faze-splash-seen';
const FULL_MS = 1350; // matches the end of the CSS timeline (wipe ends at 1280ms)
const REDUCED_MS = 480; // 250ms hold + 200ms fade
const SKIP_MS = 180;

const seenScript = `try{if(sessionStorage.getItem('${KEY}'))document.currentScript.parentNode.setAttribute('data-seen','')}catch(e){}`;

type Phase = 'play' | 'leaving' | 'done';

// Brush paths in a 1600x900 box. They keep the centre band (y 360-540) clear so the
// wordmark keeps its clearance; ends run off-canvas so butt caps never show.
const STROKES = [
  { d: 'M -160 230 C 260 140, 640 300, 1040 210 S 1520 170, 1780 240', w: 200 },
  { d: 'M 1780 690 C 1360 620, 960 760, 560 660 S 60 640, -180 700', w: 230 },
  { d: 'M 1060 -180 C 1210 70, 1420 230, 1800 290', w: 150 },
  { d: 'M -180 850 C 340 770, 880 900, 1320 800 S 1640 770, 1800 810', w: 180 },
];

export default function Splash({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('play');
  const [imgFailed, setImgFailed] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const playing = useRef(true);
  // Decided once per mount; a ref survives StrictMode's effect double-run, so the
  // second run does not read the flag the first run just wrote.
  const seenAtMount = useRef<boolean | null>(null);

  const finish = useCallback(() => { playing.current = false; setPhase('done'); }, []);

  const skip = useCallback(() => {
    if (!playing.current) return;
    playing.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase('done'), SKIP_MS);
    setPhase('leaving');
  }, []);

  useEffect(() => {
    if (seenAtMount.current === null) {
      let seen = overlay.current?.hasAttribute('data-seen') ?? false;
      try {
        if (sessionStorage.getItem(KEY)) seen = true;
        sessionStorage.setItem(KEY, '1');
      } catch { /* storage blocked: just play it */ }
      seenAtMount.current = seen;
    }
    if (seenAtMount.current) { finish(); return; }
    if (!playing.current) return;

    // Image may have errored before hydration attached onError.
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setImgFailed(true);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    timer.current = window.setTimeout(finish, reduced ? REDUCED_MS : FULL_MS);
    return () => window.clearTimeout(timer.current);
  }, [finish]);

  useEffect(() => {
    if (phase !== 'play') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        if (e.key === ' ') e.preventDefault();
        skip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, skip]);

  const appClass = phase === 'play' ? 'faze-splash-app' : phase === 'leaving' ? 'faze-splash-app is-colored' : undefined;

  return (
    <>
      {phase !== 'done' && (
        <div
          ref={overlay}
          className={`faze-splash${phase === 'leaving' ? ' is-leaving' : ''}`}
          role="presentation"
          onClick={skip}
          suppressHydrationWarning
        >
          <script dangerouslySetInnerHTML={{ __html: seenScript }} />
          <div className="faze-splash-field" />
          <svg className="faze-splash-strokes" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
            <defs>
              <filter id="faze-splash-brush" x="-10%" y="-20%" width="120%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.08" numOctaves="2" seed="7" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="34" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>
            <g filter="url(#faze-splash-brush)">
              {STROKES.map((s, i) => (
                <path key={i} className={`faze-splash-stroke s${i + 1}`} d={s.d} strokeWidth={s.w} pathLength={1} />
              ))}
            </g>
          </svg>
          <div className="faze-splash-mark">
            {imgFailed
              ? <span className="faze-splash-text">FAZE VAULT</span>
              // eslint-disable-next-line @next/next/no-img-element
              : <img ref={img} src="/brand/faze-wordmark-white.png" alt="FaZe Clan" onError={() => setImgFailed(true)} />}
          </div>
          <button
            type="button"
            className="faze-splash-skip"
            onClick={e => { e.stopPropagation(); skip(); }}
          >
            Skip intro
          </button>
        </div>
      )}
      <div className={appClass}>{children}</div>
    </>
  );
}
