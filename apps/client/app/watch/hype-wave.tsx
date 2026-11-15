'use client';
// The hype wave: chat energy over the last two minutes, with the popup threshold drawn as a dashed line.
import { useMemo } from 'react';
import type { HypeSnapshot } from '../../lib/hype';
import type { ChatStatus } from '../../lib/twitch-chat';

const W = 1000, H = 190, PAD = { l: 8, r: 8, t: 14, b: 24 };
const MIN_SPAN = 40; // seconds shown before there is a full window of data: the graph fills the width and grows from there

const fmt = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}s`);

function mood(s: HypeSnapshot | null): { label: string; tone: 'calm' | 'warm' | 'hot' } {
  if (!s) return { label: 'Listening…', tone: 'calm' };
  if (s.recent >= s.threshold) return { label: 'HYPE', tone: 'hot' };
  if (s.recent >= s.threshold * 0.55) return { label: 'Heating up', tone: 'warm' };
  return { label: 'Calm', tone: 'calm' };
}

export default function HypeWave({ snap, status, channel, demo, onDemo }: { snap: HypeSnapshot | null; status: ChatStatus; channel: string; demo: boolean; onDemo: () => void }) {
  const m = mood(snap);
  const geo = useMemo(() => {
    const series = snap?.series ?? [];
    const top = Math.max(12, (snap?.threshold ?? 9) * 1.5, (snap?.peak ?? 0) * 1.12);
    const span = Math.min(120, Math.max(series.length, MIN_SPAN));
    const x = (i: number, n: number) => PAD.l + ((W - PAD.l - PAD.r) * (span - n + i)) / (span - 1);
    const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - Math.max(0, Math.min(v, top)) / top);
    const pts = series.map((v, i) => [x(i, series.length), y(v)] as const);
    // smooth line through the points (Catmull-Rom -> cubic Bezier), so it reads as a wave rather than a jagged chart
    let line = '';
    pts.forEach(([px, py], i) => {
      if (i === 0) { line = `M${px.toFixed(1)},${py.toFixed(1)}`; return; }
      const [p0x, p0y] = pts[i - 2] ?? pts[i - 1], [p1x, p1y] = pts[i - 1], [p3x, p3y] = pts[i + 1] ?? pts[i];
      line += ` C${(p1x + (px - p0x) / 6).toFixed(1)},${(p1y + (py - p0y) / 6).toFixed(1)} ${(px - (p3x - p1x) / 6).toFixed(1)},${(py - (p3y - py) / 6).toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
    });
    const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD.b} L${pts[0][0].toFixed(1)},${H - PAD.b} Z` : '';
    const peak = snap && snap.peakIndex >= 0 && snap.peak >= snap.threshold * 0.4 ? { x: x(snap.peakIndex, series.length), y: y(snap.peak), ago: series.length - 1 - snap.peakIndex, v: snap.peak } : null;
    return { line, area, ty: y(snap?.threshold ?? 9), peak, top, span };
  }, [snap]);

  return <section className="hype" aria-label="Chat hype wave">
    <div className="hype-head">
      <div><p className="eyebrow">CHAT HYPE WAVE · #{channel || '…'}</p>
        <h2>The hypest moments, found from chat.</h2></div>
      <div className="hype-meta">
        <span className={`hype-mood hype-${m.tone}`} role="status">{m.label}</span>
        <span className="hype-stat">{snap ? `${snap.msgsRecent} msgs / 4s` : '—'}</span>
        <span className={`hype-conn hype-conn-${status}`}>{status === 'connected' ? '● chat connected' : status === 'closed' ? 'chat off' : '○ connecting to chat'}</span>
      </div>
    </div>
    <div className={`hype-chart${m.tone === 'hot' ? ' is-hot' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={snap ? `Chat energy over the last ${fmt(geo.span)}. Currently ${m.label.toLowerCase()}.` : 'Waiting for chat'}>
        <defs>
          <linearGradient id="hype-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e4002b" stopOpacity=".55" /><stop offset="1" stopColor="#e4002b" stopOpacity="0" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => <line key={f} className="hype-grid" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (H - PAD.t - PAD.b) * f} y2={PAD.t + (H - PAD.t - PAD.b) * f} />)}
        {geo.area && <path className="hype-area" d={geo.area} />}
        {geo.line && <path className="hype-line" d={geo.line} />}
        <line className="hype-threshold" x1={PAD.l} x2={W - PAD.r} y1={geo.ty} y2={geo.ty} />
        <text className="hype-threshold-label" x={W - PAD.r - 4} y={Math.max(geo.ty - 6, 12)} textAnchor="end">POPUP THRESHOLD</text>
        {geo.peak && <g><circle className="hype-peak" cx={geo.peak.x} cy={geo.peak.y} r="6" /><text className="hype-peak-label" x={Math.min(geo.peak.x, W - 90)} y={Math.max(geo.peak.y - 12, 14)} textAnchor="middle">hypest · {geo.peak.ago}s ago</text></g>}
        <text className="hype-axis" x={PAD.l} y={H - 6}>−{fmt(geo.span)}</text><text className="hype-axis" x={W / 2} y={H - 6} textAnchor="middle">−{fmt(Math.round(geo.span / 2))}</text><text className="hype-axis" x={W - PAD.r} y={H - 6} textAnchor="end">now</text>
      </svg>
    </div>
    <div className="hype-foot">
      <p>Chat is scored for excitement (hype words, emotes, caps) every second. When it jumps far above this chat&apos;s normal, a limited card pops up.</p>
      <button type="button" className="hype-demo" onClick={onDemo}>{demo ? 'Demo running…' : 'Demo: simulate a hype spike'}</button>
    </div>
  </section>;
}
