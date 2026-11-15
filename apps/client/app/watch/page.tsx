'use client';
import type { Card, CollectionEntry, LeaderboardResponse, MeResponse, Pack } from '@faze/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, art, request } from '../../lib/api';
import ClipLab, { type Stamp } from './clip-lab';
import { canonicalUrl, chatSrc, formatTime, iframeSrc, loadEmbedJs, parseTwitchUrl, sourceLabel, type TwitchGlobal, type TwitchSource } from './twitch';
import './watch.css';

/*
 * /watch: Twitch watch-along. Any Twitch channel / VOD / clip link can be pasted (kept in ?src= so it's shareable).
 * Channel + VOD use Embed JS (plain iframe fallback); clips use the clip iframe. Card tie-ins use existing public
 * endpoints only (/leaderboard trending, /packs, optional /me/cards). The client-side ONLINE/OFFLINE signal is
 * display-only and never gates rewards.
 */
const CHANNEL = (process.env.NEXT_PUBLIC_TWITCH_CHANNEL ?? 'faze').trim().toLowerCase() || 'faze';
const DEFAULT_SOURCE: TwitchSource = { kind: 'channel', channel: CHANNEL };
const EXTRA_PARENTS = list(process.env.NEXT_PUBLIC_TWITCH_PARENTS);
const ON_STREAM = list(process.env.NEXT_PUBLIC_TWITCH_ON_STREAM);
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;
const POLL_MS = 30_000;
type Live = 'unknown' | 'online' | 'offline';
type Trending = LeaderboardResponse['trending'];

function list(v: string | undefined) { return (v ?? '').split(',').map(s => s.trim()).filter(Boolean); }
const sameSource = (a: TwitchSource, b: TwitchSource) => canonicalUrl(a) === canonicalUrl(b);

function MiniCard({ card, note }: { card: Card; note?: React.ReactNode }) {
  return <article className={`watch-card ${card.rarity}`}>
    <div className="watch-card-art"><img src={art(card.artUrl)} alt={card.name} loading="lazy" />{card.demo && <span className="watch-demo">DEMO</span>}</div>
    <small>{card.fazeMember}</small><h4>{card.name}</h4>{note}
  </article>;
}

export default function Watch() {
  const [host, setHost] = useState<string | null>(null);
  const [embeddable, setEmbeddable] = useState(true);
  const [source, setSource] = useState<TwitchSource>(DEFAULT_SOURCE);
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState('');
  const [live, setLive] = useState<Live>('unknown');
  const [fallbackIframe, setFallbackIframe] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [trending, setTrending] = useState<Trending>([]);
  const [tickerState, setTickerState] = useState<'loading' | 'ok' | 'error'>('loading');
  const prevHype = useRef<Record<string, number>>({});
  const [delta, setDelta] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<string[]>(ON_STREAM);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mine, setMine] = useState<CollectionEntry[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const playerBox = useRef<HTMLDivElement>(null);
  const embedRef = useRef<TwitchGlobal>(null);

  // Host + SSL precondition (Twitch needs HTTPS; http://localhost is tolerated, plain-http LAN IPs are not) + ?src=.
  useEffect(() => {
    const { hostname, protocol, search } = window.location;
    setHost(hostname);
    setEmbeddable(protocol === 'https:' || LOOPBACK.test(hostname));
    const src = new URLSearchParams(search).get('src');
    if (src) {
      const parsed = parseTwitchUrl(src);
      if (parsed) { setSource(parsed); setLinkInput(src); } else setLinkError(`“${src}” in the link isn’t a Twitch channel, VOD or clip. Showing twitch.tv/${CHANNEL}.`);
    }
  }, []);

  function applySource(next: TwitchSource) {
    setSource(next); setLive('unknown'); setFallbackIframe(false); setLinkError('');
    const url = new URL(window.location.href);
    if (sameSource(next, DEFAULT_SOURCE)) url.searchParams.delete('src'); else url.searchParams.set('src', canonicalUrl(next));
    window.history.replaceState(null, '', url.toString());
  }
  function submitLink(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTwitchUrl(linkInput);
    if (!parsed) { setLinkError('Paste a Twitch link: a channel (twitch.tv/faze), a VOD (twitch.tv/videos/123?t=1h2m3s) or a clip.'); return; }
    applySource(parsed);
  }

  // `parent` = the bare hostname serving this page (no scheme/port), so localhost, LAN/Tailscale and deploy hosts all match.
  const parents = useMemo(() => (host ? [...new Set([host.replace(/^\[|\]$/g, ''), ...EXTRA_PARENTS])] : []), [host]);
  const sourceKey = canonicalUrl(source);
  const useEmbedJs = source.kind !== 'clip' && !fallbackIframe;

  // Everything Embed (video only) for channels + VODs: gives ONLINE/OFFLINE and getCurrentTime(). Blocked → plain iframe.
  useEffect(() => {
    if (!host || !embeddable || !useEmbedJs) return;
    let cancelled = false;
    const s = source;
    loadEmbedJs().then(() => {
      if (cancelled) return;
      const T = window.Twitch;
      const ONLINE = T.Player?.ONLINE ?? 'online', OFFLINE = T.Player?.OFFLINE ?? 'offline';
      const opts = s.kind === 'video' ? { video: s.id, ...(s.seconds ? { time: formatTime(s.seconds) } : {}), autoplay: false } : { channel: s.kind === 'channel' ? s.channel : CHANNEL, autoplay: true };
      const embed = new T.Embed('twitch-player', { ...opts, parent: parents, width: '100%', height: '100%', layout: 'video', muted: true });
      embedRef.current = embed;
      // The Embed object re-dispatches the player's events (ONLINE/OFFLINE/PLAYING...).
      if (s.kind === 'channel') {
        embed.addEventListener(ONLINE, () => !cancelled && setLive('online'));
        embed.addEventListener(OFFLINE, () => !cancelled && setLive('offline'));
        embed.addEventListener(T.Embed.VIDEO_PLAY, () => !cancelled && setLive('online'));
      }
    }).catch(() => { if (!cancelled) setFallbackIframe(true); });
    return () => { cancelled = true; embedRef.current = null; document.getElementById('twitch-player')?.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, embeddable, parents, useEmbedJs, sourceKey]);

  // Hype ticker: public /leaderboard trending every 30 s, skipped while the tab is hidden.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>, stopped = false;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const b = await request<LeaderboardResponse>('/leaderboard');
          if (stopped) return;
          const d: Record<string, number> = {};
          for (const t of b.trending) { const p = prevHype.current[t.card.id]; if (p !== undefined && p !== t.hype) d[t.card.id] = t.hype - p; }
          prevHype.current = Object.fromEntries(b.trending.map(t => [t.card.id, t.hype]));
          setTrending(b.trending); setDelta(d); setTickerState('ok');
        } catch { if (!stopped) setTickerState(s => (s === 'ok' ? s : 'error')); }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  // Optional: cheapest pack for the CTA, and the signed-in fan's own cards (401 just hides that section).
  useEffect(() => {
    request<{ packs: Pack[] }>('/packs').then(r => setPacks(r.packs)).catch(() => {});
    request<MeResponse>('/me').then(async m => {
      setMe(m);
      setMine((await request<{ cards: CollectionEntry[] }>('/me/cards')).cards);
    }).catch(e => { if (!(e instanceof ApiError)) console.warn('watch: session check failed', e); });
  }, []);

  /** Moment timestamp: VOD position from the player; clips/live/fallback iframes have no readable position → wall clock. */
  const getStamp = useCallback((): Stamp => {
    const now = new Date().toISOString();
    if (source.kind === 'video') {
      try {
        const t = embedRef.current?.getPlayer?.()?.getCurrentTime?.();
        if (typeof t === 'number' && Number.isFinite(t)) return { timestampMs: Math.round(t * 1000), label: `VOD ${source.id} @ ${formatTime(t)}` };
      } catch { /* fall through */ }
      return { timestampIso: now, label: `VOD ${source.id}, position unavailable · captured ${new Date(now).toLocaleString()}` };
    }
    if (source.kind === 'clip') return { timestampIso: now, label: `Clip ${source.slug}, offset unavailable · captured ${new Date(now).toLocaleString()}` };
    return { timestampIso: now, label: `${live === 'online' ? 'Live' : 'Channel'} · ${new Date(now).toLocaleString()}` };
  }, [source, live]);

  const members = useMemo(() => [...new Set([...ON_STREAM, ...trending.map(t => t.card.fazeMember)])], [trending]);
  const inFocus = (m: string) => focus.length === 0 || focus.includes(m);
  const pack = useMemo(() => [...packs].sort((a, b) => a.priceCoins - b.priceCoins)[0], [packs]);
  const focusedTrending = trending.filter(t => inFocus(t.card.fazeMember));
  const focusedMine = mine.filter(c => inFocus(c.card.fazeMember));

  const channelForLinks = source.kind === 'channel' ? source.channel : source.kind === 'clip' && source.channel ? source.channel : CHANNEL;
  const twitchUrl = canonicalUrl(source);
  const chat = source.kind === 'channel' && parents.length ? chatSrc(source.channel, parents) : '';
  const chatOn = showChat && embeddable && !!chat;
  const label = sourceLabel(source);
  const status = !embeddable ? 'Embed unavailable on this address'
    : source.kind === 'video' ? 'VOD · REPLAY' : source.kind === 'clip' ? 'CLIP'
    : live === 'online' ? '● LIVE NOW' : live === 'offline' ? 'OFFLINE' : 'Checking stream…';

  return <div className="watch-root">
    <header>
      <a className="brand" href="/">F<span>Λ</span>ZE <b>VAULT</b></a>
      <div className="account">
        {me && <strong>{me.balance.toLocaleString()} <small>COINS</small></strong>}
        <a className="watch-back" href="/">← Back to vault</a>
      </div>
    </header>
    <main className="watch">
      <section className="watch-head">
        <p className="eyebrow">WATCH ALONG / {label.toUpperCase()}</p>
        <h1>Watch live. <span>Pull what you see.</span></h1>
        <p className={`watch-status ${source.kind === 'channel' ? live : source.kind}`} role="status">{status}</p>
      </section>

      <form className="watch-link" onSubmit={submitLink}>
        <label htmlFor="watch-src">Paste a Twitch channel, VOD or clip link</label>
        <div className="watch-link-row">
          <input id="watch-src" type="text" inputMode="url" value={linkInput} onChange={e => setLinkInput(e.target.value)}
            placeholder={`twitch.tv/${CHANNEL} · twitch.tv/videos/123?t=1h2m3s · clips.twitch.tv/…`} autoComplete="off" spellCheck={false}
            aria-invalid={!!linkError || undefined} aria-describedby={linkError ? 'watch-src-error' : undefined} />
          <button className="primary" type="submit">Load</button>
          {!sameSource(source, DEFAULT_SOURCE) && <button type="button" onClick={() => { setLinkInput(''); applySource(DEFAULT_SOURCE); }}>Back to twitch.tv/{CHANNEL}</button>}
        </div>
        {linkError && <p id="watch-src-error" className="watch-lab-msg error" role="alert">{linkError}</p>}
      </form>

      <div className="watch-ticker" aria-label="Trending card hype, simulated engagement">
        <span className="watch-ticker-label">HYPE · SIMULATED</span>
        <div className="watch-ticker-window">
          {trending.length > 0
            ? <div className="watch-ticker-track">
                {[...trending, ...trending].map((t, i) => <span key={`${t.card.id}-${i}`} aria-hidden={i >= trending.length || undefined}>
                  {t.card.name} <b>{t.hype}</b>{delta[t.card.id] ? <em className={delta[t.card.id] > 0 ? 'up' : 'down'}>{delta[t.card.id] > 0 ? '▲' : '▼'}{Math.abs(delta[t.card.id])}</em> : null}
                </span>)}
              </div>
            : <span className="watch-ticker-empty">{tickerState === 'loading' ? 'Loading hype…' : tickerState === 'error' ? 'Hype feed unavailable right now.' : 'No trending cards yet.'}</span>}
        </div>
      </div>

      <div className={`watch-stage${chatOn ? ' with-chat' : ''}`}>
        <div className="watch-player" ref={playerBox}>
          {!embeddable
            ? <div className="watch-fallback">
                <p className="eyebrow">EMBED NEEDS HTTPS</p>
                <h2>Open the stream on Twitch</h2>
                <p>Twitch only plays embedded streams on HTTPS sites. This page is on plain HTTP ({host}), so Twitch would refuse the player.</p>
                <a className="watch-button primary" href={twitchUrl} target="_blank" rel="noreferrer">Open on Twitch ↗</a>
              </div>
            : !parents.length ? null
            : useEmbedJs
              ? <div id="twitch-player" key={sourceKey} />
              : <iframe key={sourceKey} title={`${label} on Twitch`} src={iframeSrc(source, parents)} allowFullScreen />}
        </div>
        {chatOn && <iframe className="watch-chat" title="Twitch chat" src={chat} />}
      </div>

      {source.kind === 'channel' && live === 'offline' && embeddable && <section className="watch-offline" aria-live="polite">
        <div><p className="eyebrow">STREAM OFFLINE</p><h2>{source.channel === 'faze' ? 'FaZe' : source.channel} isn’t live right now.</h2>
          <p>Follow the channel to catch the next broadcast. The player above shows recent videos meanwhile. Keep collecting below.</p></div>
        <a className="watch-button" href={`https://www.twitch.tv/${source.channel}`} target="_blank" rel="noreferrer">Follow on Twitch ↗</a>
      </section>}

      <div className="watch-controls">
        {embeddable && chat && <button onClick={() => setShowChat(v => !v)} aria-pressed={!showChat}>{showChat ? 'Hide chat' : 'Show chat'}</button>}
        <a className="watch-button" href={twitchUrl} target="_blank" rel="noreferrer">Open on Twitch ↗</a>
        {source.kind !== 'channel' && <a className="watch-button" href={`https://www.twitch.tv/${channelForLinks}`} target="_blank" rel="noreferrer">twitch.tv/{channelForLinks} ↗</a>}
      </div>

      <ClipLab playerEl={() => playerBox.current} getStamp={getStamp} sourceUrl={twitchUrl} sourceLabel={label} members={members} canEmbed={embeddable} />

      <section className="watch-cta panel">
        <div><p className="eyebrow">WHILE YOU WATCH</p><h2>{pack ? pack.name : 'Open a pack'}</h2>
          <p>{pack ? `${pack.cardsPerPack} cards · ${pack.priceCoins} coins · published odds v${pack.oddsVersion}` : 'Packs open in the vault store. Every pull is decided by the server.'}</p></div>
        <a className="watch-button primary" href="/">{me ? 'Open a pack in the store →' : 'Sign in to open a pack →'}</a>
      </section>

      <section className="watch-focus">
        <h3>WHO’S ON STREAM?</h3>
        <p className="watch-hint">{ON_STREAM.length ? 'Preselected by FaZe staff for this stream.' : 'Pick the members you see.'} Tap to filter the cards.</p>
        {members.length > 0 && <div className="watch-chips">
          {members.map(m => <button key={m} aria-pressed={focus.includes(m)} onClick={() => setFocus(f => f.includes(m) ? f.filter(x => x !== m) : [...f, m])}>{m}</button>)}
          {focus.length > 0 && <button className="watch-chip-clear" onClick={() => setFocus([])}>Show all</button>}
        </div>}
        <h3>TRENDING / SIMULATED ENGAGEMENT</h3>
        <div className="watch-grid">
          {focusedTrending.map(t => <MiniCard key={t.card.id} card={t.card} note={<p className="hype">HYPE {t.hype}/100 · SIMULATED</p>} />)}
        </div>
        {focusedTrending.length === 0 && <p className="empty">{tickerState === 'error' ? 'Trending cards could not be loaded.' : trending.length ? 'No trending cards for these members.' : 'No trending cards yet.'}</p>}
        {me && <>
          <h3>YOUR CARDS OF THEM</h3>
          <div className="watch-grid">{focusedMine.map(c => <MiniCard key={c.card.id} card={c.card} note={<p>{c.count} owned</p>} />)}</div>
          {focusedMine.length === 0 && <p className="empty">None yet. Open a pack.</p>}
        </>}
      </section>
    </main>
    <footer>FΛZE VAULT / DEMO COLLECTIBLES <span>Stream embedded from Twitch. Hype is simulated engagement.</span></footer>
  </div>;
}
