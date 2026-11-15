'use client';
// "LIVE" pill: shown when the FaZe Twitch channel is live (API caches Twitch for 60 s). Renders nothing otherwise.
import { useEffect, useState } from 'react';
import { request } from '../lib/api';

export default function LivePill() {
  const [live, setLive] = useState<{ title?: string; viewers?: number } | null>(null);
  useEffect(() => {
    let off = false;
    const poll = async () => {
      try { const r = await request<{ live: boolean; title?: string; viewers?: number }>('/twitch/live'); if (!off) setLive(r.live ? r : null); }
      catch { if (!off) setLive(null); }
    };
    poll(); const id = setInterval(poll, 60000);
    return () => { off = true; clearInterval(id); };
  }, []);
  if (!live) return null;
  return <a className="live-pill" href="/watch" title={live.title ? `${live.title} · ${live.viewers ?? 0} watching` : 'FaZe is live on Twitch'}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#E4002B', color: '#fff', borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textDecoration: 'none' }}>
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />LIVE</a>;
}
