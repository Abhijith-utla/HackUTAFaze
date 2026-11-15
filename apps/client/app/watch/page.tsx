'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, request } from '../../lib/api';
import { HypeMeter, type HypeSnapshot } from '../../lib/hype';
import { connectChat, type ChatStatus } from '../../lib/twitch-chat';
import HypePopup, { type Offer } from './hype-popup';
import HypeWave from './hype-wave';
import { chatSrc, loadEmbedJs, parseTwitchUrl } from './twitch';
import './watch.css';

/*
 * /watch: the stream, its chat, and a hype wave. The page finds a live Call of Duty stream by itself (Twitch API when configured,
 * else a list of known COD streamers tried in order), reads chat energy, and when it spikes offers a limited card to collect.
 * ?src=<channel> pins a specific channel (kept for sharing; there is no link box).
 */
const FALLBACK_COD = ['symfuhny', 'scump', 'hitch', 'nickmercs', 'timthetatman', 'metaphor', 'tommey', 'nadeshot', 'aydan', 'dashy', 'hutch', 'cleanx', 'shotzzy', 'simp', 'kenny', 'dougisraw', 'jgod', 'acehart', 'swagg', 'teepee', 'zlaner'];
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;
const EXTRA_PARENTS = (process.env.NEXT_PUBLIC_TWITCH_PARENTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CHECK_MS = 9000;
type Live = 'checking' | 'online' | 'offline' | 'none';

export default function Watch() {
  const [host, setHost] = useState('');
  const [embeddable, setEmbeddable] = useState(true);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [pinned, setPinned] = useState(false);
  const [idx, setIdx] = useState(0);
  const [live, setLive] = useState<Live>('checking');
  const [chatStatus, setChatStatus] = useState<ChatStatus>('closed');
  const [snap, setSnap] = useState<HypeSnapshot | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [coins, setCoins] = useState<number | null>(null);
  const [popup, setPopup] = useState<{ score: number; demo: boolean } | null>(null);
  const [demo, setDemo] = useState(false);
  const meter = useRef(new HypeMeter());
  const popupOpen = useRef(false);
  const offerRef = useRef<Offer | null>(null);
  offerRef.current = offer; popupOpen.current = !!popup;

  const parents = useMemo(() => (host ? [...new Set([host.replace(/^\[|\]$/g, ''), ...EXTRA_PARENTS])] : []), [host]);
  const current = candidates?.[idx] ?? '';

  // Page setup + which channels to try.
  useEffect(() => {
    const { hostname, protocol, search } = window.location;
    setHost(hostname);
    setEmbeddable(protocol === 'https:' || LOOPBACK.test(hostname));
    const q = new URLSearchParams(search);
    const src = q.get('src') ?? q.get('channel');
    const parsed = src ? parseTwitchUrl(src.includes('.') ? src : `twitch.tv/${src}`) : null;
    if (parsed?.kind === 'channel') { setCandidates([parsed.channel]); setPinned(true); return; }
    request<{ streams: { login: string }[] }>('/twitch/live-cod')
      .then(r => setCandidates([...new Set([...r.streams.map(s => s.login.toLowerCase()), ...FALLBACK_COD])]))
      .catch(() => setCandidates(FALLBACK_COD));
  }, []);

  // The signed-in fan's coins and the popup card's offer (a 401 just means "show a sign-in prompt in the popup").
  useEffect(() => {
    request<{ balance: number }>('/me').then(m => { setCoins(m.balance); setSignedIn(true); }).catch(e => { if (!(e instanceof ApiError)) console.warn('watch: /me failed', e); });
    request<Offer>('/moments/hype/offer').then(setOffer).catch(() => {});
  }, []);

  const nextChannel = useCallback(() => {
    setIdx(i => { if (candidates && i + 1 < candidates.length) return i + 1; setLive('none'); return i; });
  }, [candidates]);

  // Player: Twitch Embed for the current channel. OFFLINE (or silence for a while) -> try the next candidate.
  useEffect(() => {
    if (!current || !host || !embeddable) return;
    let cancelled = false, settled = false;
    setLive('checking'); meter.current.reset(); setSnap(null);
    const giveUp = () => { if (cancelled || settled) return; settled = true; if (pinned) setLive('offline'); else nextChannel(); };
    const timer = setTimeout(giveUp, CHECK_MS);
    loadEmbedJs().then(() => {
      if (cancelled) return;
      const T = window.Twitch;
      const ONLINE = T.Player?.ONLINE ?? 'online', OFFLINE = T.Player?.OFFLINE ?? 'offline';
      const embed = new T.Embed('twitch-player', { channel: current, autoplay: true, parent: parents, width: '100%', height: '100%', layout: 'video', muted: true });
      embed.addEventListener(ONLINE, () => { if (cancelled) return; settled = true; clearTimeout(timer); setLive('online'); });
      embed.addEventListener(T.Embed.VIDEO_PLAY, () => { if (cancelled) return; settled = true; clearTimeout(timer); setLive('online'); });
      embed.addEventListener(OFFLINE, () => { clearTimeout(timer); giveUp(); });
    }).catch(() => { if (!cancelled) setLive('offline'); });
    return () => { cancelled = true; clearTimeout(timer); document.getElementById('twitch-player')?.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, host, embeddable, parents, pinned]);

  const openPopup = useCallback((score: number, isDemo: boolean) => {
    if (popupOpen.current || !offerRef.current || offerRef.current.owned) return;
    setPopup({ score, demo: isDemo });
  }, []);

  // Chat energy: only while the stream is actually live. One snapshot per second drives the graph and the popup.
  useEffect(() => {
    if (live !== 'online' || !current) return;
    const stop = connectChat(current, m => meter.current.push(m.text, m.emotes, Date.now()), setChatStatus);
    const tick = setInterval(() => {
      const s = meter.current.snapshot(Date.now());
      setSnap(s);
      if (s.triggered) openPopup(s.recent, false);
    }, 1000);
    return () => { stop(); clearInterval(tick); setChatStatus('closed'); };
  }, [live, current, openPopup]);

  // Demo: a short burst of synthetic hype through the SAME meter (so the graph really surges), then the popup. Clearly labelled.
  const simulate = useCallback(() => {
    if (demo) return;
    setDemo(true);
    const lines = ['LETS GOOOO POG!!!', 'CLIP IT CLIP IT', 'OMG WTF INSANE', 'NO WAY HOLY', 'POGGERS W W W', 'CLUTCH!!!'];
    let n = 0;
    const pump = setInterval(() => { for (let k = 0; k < 4; k++) meter.current.push(lines[(n++) % lines.length], 3, Date.now()); setSnap(meter.current.snapshot(Date.now())); }, 120);
    setTimeout(() => { clearInterval(pump); openPopup(meter.current.snapshot(Date.now()).recent || 60, true); setDemo(false); }, 3500);
  }, [demo, openPopup]);

  const chat = current && parents.length && embeddable ? chatSrc(current, parents) : '';
  const status = !embeddable ? 'Embed unavailable on this address (Twitch needs https or localhost)'
    : live === 'online' ? `● LIVE NOW · twitch.tv/${current}`
    : live === 'none' ? 'No live Call of Duty streams found right now. Try again in a few minutes.'
    : live === 'offline' ? `twitch.tv/${current} is offline`
    : candidates ? 'Finding a live Call of Duty stream…' : 'Loading…';

  return <div className="watch-root">
    <header>
      <a className="brand" href="/">F<span>Λ</span>ZE <b>CLIPDECK</b></a>
      <div className="account">
        {coins !== null && <strong>{coins.toLocaleString()} <small>COINS</small></strong>}
        <a className="watch-back" href="/">← Back to ClipDeck</a>
      </div>
    </header>
    <main className="watch">
      <section className="watch-head">
        <p className="eyebrow">WATCH ALONG / LIVE CALL OF DUTY</p>
        <h1>Watch live. <span>Pull what you see.</span></h1>
        <p className={`watch-status ${live}`} role="status">{status}{!pinned && live === 'online' && candidates && idx + 1 < candidates.length && <button type="button" className="watch-next" onClick={nextChannel}>Next stream ›</button>}</p>
      </section>
      <div className="watch-stage">
        <div className="watch-player"><div id="twitch-player" />{live !== 'online' && <div className="watch-wait" aria-hidden="true">{live === 'none' || live === 'offline' ? 'No live stream' : 'Finding a live stream…'}</div>}</div>
        {chat && <iframe className="watch-chat" title="Twitch chat" src={chat} />}
      </div>
      <HypeWave snap={snap} status={chatStatus} channel={live === 'online' ? current : ''} demo={demo} onDemo={simulate} />
    </main>
    {popup && offer && <HypePopup offer={offer} channel={current} score={popup.score} demo={popup.demo} signedIn={signedIn}
      onClose={() => setPopup(null)} onCollected={b => { setCoins(b); setOffer(o => (o ? { ...o, owned: true, balance: b } : o)); }} />}
  </div>;
}
