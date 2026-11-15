# Design A: Twitch watch-along page (`/watch`)

Status: proposal. No repo files changed. The files involved are in `apps/client/`, which **@Jaideepo7** owns (Agent C). Before anyone edits them, ask for a handoff on the board (AGENTS.md section 3).

## 1. Which channel

| Channel | Verdict | Evidence (checked 2026-11-15) |
|---|---|---|
| `twitch.tv/faze` | **Official FaZe Clan channel. Use as the default.** | Twitch ID 20761874. Partner since Feb 26 2011. About 574k followers. Last seen live Nov 12 2026; the latest title was "FAZE $100K FLANK INVITATIONAL DAY 1 W/ @ZOOMAA #FaZeUp" (COD MW4). Live about 7 h in the last 30 days, so **it is offline most of the time**. Sources: twitchmetrics.net/c/20761874-faze, twitchtracker.com/faze, streamscharts (Partner, created 2011). |
| `twitch.tv/fazeclan` | **Not official. Do not use.** | 261 followers, no Partner status (twitchtracker.com/fazeclan). |
| `fazeapex` and others | Sub-brand or esports channels | Possible alternates via env. |

Context: the 2025-26 creator exodus (most creators left FaZe; some multistream on Kick) means the channel is mainly an esports and event channel now. Design for **offline first**: offline is the default state, and live is the bonus.

Make it configurable: `NEXT_PUBLIC_TWITCH_CHANNEL=faze`. Add the line to `.env.example`, which is root config owned by the lead.

## 2. Twitch embed rules (verified on dev.twitch.tv/docs/embed)

- Player iframe: `https://player.twitch.tv/?channel=<ch>&parent=<host>[&parent=<host2>]&muted=true`. Pass the bare hostname: no scheme, no port.
- Interactive player JS: `https://player.twitch.tv/js/embed/v1.js` → `new Twitch.Player(divId, {channel, parent:[...], width, height, muted, autoplay})`. It fires events `Twitch.Player.ONLINE`, `OFFLINE`, `READY`, `PLAYING` and `PAUSE`. **This is the only way to learn live/offline without a server-side Helix call.** That is why we use it instead of a plain iframe.
- Everything embed (`embed.twitch.tv/embed/v1.js`, `Twitch.Embed`) bundles video and chat with layout `video-with-chat`. We skip it so the layout stays ours on mobile.
- Chat iframe: `https://www.twitch.tv/embed/<ch>/chat?parent=<host>`. Appending `&darkpopout` gives dark chat. Many sites use it, but it is **not in the current docs**, so treat it as best effort.
- `parent` must list every host that serves the page: `localhost`, the deploy domain, a Tailscale MagicDNS name, and so on. A missing or wrong parent makes Twitch show its "playback error, watch on twitch.tv" screen. We compute `parent` at runtime from `window.location.hostname`, so it always matches the current host. `NEXT_PUBLIC_TWITCH_PARENTS` adds extra hosts and is only needed if the page is itself framed by another site.
- **SSL is required**: "Domains that use Twitch embeds must use SSL certificates." In practice `http://localhost` is accepted. **Plain-http LAN IPs (`http://192.168.x.x:3000`), which the team uses for phone demos, will fail.** The page detects this case (`protocol !== 'https:'` and the host is not loopback) and shows a branded fallback with an "Open on Twitch" link instead of a broken frame. For phone demos, use `tailscale serve` (HTTPS + MagicDNS name) or the deployed domain.
- Minimum size is 400x300 for player and chat. On phones narrower than 400px this cannot be met exactly. Use `width:100%`, `aspect-ratio:16/9` and `min-height:300px` on the player. Note that autoplay "requires minimum size and visibility", and mobile needs a user tap anyway. Start muted.
- Do not obscure the embed. No overlays on top of the iframe; the hype ticker sits outside it. Chat sending is disabled when the frame is obscured or hidden.
- Check that no CSP blocks it: `apps/client/next.config.mjs` sets no headers, so no `frame-src`/`script-src` is in effect today. If a CSP is added later, it needs:
  `frame-src https://player.twitch.tv https://www.twitch.tv https://clips.twitch.tv; script-src 'self' https://player.twitch.tv`.
- The API's CSP (art routes only) is unaffected.

## 3. Card tie-ins (no contract change)

All of these use endpoints that already exist (`docs/api.md` v1.6):

1. **Live hype ticker.** `GET /leaderboard` is public and returns `trending` (top 10 by `card_stats.hype`). Poll every 30 s, pause when `document.hidden`, and show the ▲/▼ delta against the previous poll. Label it "SIMULATED ENGAGEMENT", as master.md section 3 requires.
2. **"On stream" member focus.** We do not know who is on screen. Getting that needs Helix `GET /streams` (title) with a server-side client secret, which means a new endpoint and therefore a contract change. Instead:
   - `NEXT_PUBLIC_TWITCH_ON_STREAM="FaZe Banks,FaZe Rug"`, set by staff before an event, preselects member chips.
   - Fans can toggle chips built from the `fazeMember` values in `trending`.
   - The filtered view shows trending cards plus, when logged in, **your own cards** of those members (`GET /me/cards`, filtered client-side by `card.fazeMember`). A 401 just hides that section.
3. **Open-a-pack CTA.** `GET /packs` (public) gives the cheapest live pack. If logged in, "Open now" calls `POST /packs/:id/open {idempotencyKey}` and reuses the existing `PackOpening` overlay. The server stays authoritative. Otherwise it links to `/` to sign in.
4. **Out of scope without lead approval:** drops tied to live moments ("pack unlocks when the stream goes live", a "watch-time reward", "a card minted from this clip"). These change the economy and the contract (new endpoints, ledger reasons) and need @Abhijith-utla. A live-gated drop would also need a server-side live check, because the client-reported ONLINE event must never gate rewards.

## 4. Files

- `apps/client/app/watch/page.tsx` (new)
- `apps/client/app/watch/watch.css` (new)
- `apps/client/app/page.tsx`: one link (below)
- `.env.example` (lead): `NEXT_PUBLIC_TWITCH_CHANNEL=faze`, `NEXT_PUBLIC_TWITCH_ON_STREAM=`, `NEXT_PUBLIC_TWITCH_PARENTS=`

Nav link in `page.tsx`, next to the existing trades link:
```tsx
<a className="market-public-link" href="/trades">Browse public trades →</a>
<a className="market-public-link watch-link" href="/watch">● Watch along on Twitch →</a>
```
(`.watch-link{margin-left:18px}` goes in `polish.css`, or inline style.)

### `apps/client/app/watch/page.tsx`
```tsx
'use client';
import type { Card, CardInstance, CollectionEntry, LeaderboardResponse, MeResponse, Pack } from '@faze/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, art, request } from '../../lib/api';
import PackOpening from '../pack-opening';
import './watch.css';

const CHANNEL = (process.env.NEXT_PUBLIC_TWITCH_CHANNEL || 'faze').toLowerCase();
const EXTRA_PARENTS = (process.env.NEXT_PUBLIC_TWITCH_PARENTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const ON_STREAM = (process.env.NEXT_PUBLIC_TWITCH_ON_STREAM ?? '').split(',').map(s => s.trim()).filter(Boolean);
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const PLAYER_JS = 'https://player.twitch.tv/js/embed/v1.js';
type Live = 'unknown' | 'online' | 'offline';
declare global { interface Window { Twitch?: any } }

function loadPlayerJs(): Promise<void> {
  if (window.Twitch?.Player) return Promise.resolve();
  return new Promise((res, rej) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLAYER_JS}"]`);
    const s = existing ?? Object.assign(document.createElement('script'), { src: PLAYER_JS, async: true });
    s.addEventListener('load', () => res(), { once: true });
    s.addEventListener('error', () => rej(new Error('player script blocked')), { once: true });
    if (!existing) document.head.appendChild(s);
    setTimeout(() => rej(new Error('player script timeout')), 8000);
  });
}

function MiniCard({ card, note }: { card: Card; note?: React.ReactNode }) {
  return <article className={`watch-card ${card.rarity}`}>
    <div className="watch-card-art"><img src={art(card.artUrl)} alt={card.name} loading="lazy" /></div>
    <small>{card.fazeMember}</small><h4>{card.name}</h4>{note}{card.demo && <span className="watch-demo">DEMO</span>}
  </article>;
}

export default function Watch() {
  const [host, setHost] = useState<string | null>(null);
  const [embeddable, setEmbeddable] = useState(true);
  const [live, setLive] = useState<Live>('unknown');
  const [fallbackIframe, setFallbackIframe] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [trending, setTrending] = useState<LeaderboardResponse['trending']>([]);
  const prevHype = useRef<Record<string, number>>({});
  const [delta, setDelta] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<string[]>(ON_STREAM);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mine, setMine] = useState<CollectionEntry[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [pull, setPull] = useState<CardInstance[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const openKey = useRef<string | null>(null);

  // Host + SSL precondition (Twitch embeds need HTTPS; http://localhost is tolerated).
  useEffect(() => {
    const { hostname, protocol } = window.location;
    setHost(hostname);
    setEmbeddable(protocol === 'https:' || LOOPBACK.test(hostname));
  }, []);

  const parents = useMemo(() => (host ? [host.replace(/^\[|\]$/g, ''), ...EXTRA_PARENTS] : []), [host]);

  // Interactive player: gives ONLINE/OFFLINE events. Falls back to a plain iframe if the script is blocked.
  useEffect(() => {
    if (!host || !embeddable) return;
    let player: any; let cancelled = false;
    loadPlayerJs().then(() => {
      if (cancelled) return;
      const T = window.Twitch;
      player = new T.Player('twitch-player', { channel: CHANNEL, parent: parents, width: '100%', height: '100%', muted: true, autoplay: true });
      player.addEventListener(T.Player.ONLINE, () => setLive('online'));
      player.addEventListener(T.Player.OFFLINE, () => setLive('offline'));
    }).catch(() => !cancelled && setFallbackIframe(true));
    return () => { cancelled = true; document.getElementById('twitch-player')?.replaceChildren(); };
  }, [host, embeddable, parents]);

  // Hype ticker: public /leaderboard, 30 s, paused in background tabs.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const b = await request<LeaderboardResponse>('/leaderboard');
          const d: Record<string, number> = {};
          for (const t of b.trending) if (prevHype.current[t.card.id] !== undefined) d[t.card.id] = t.hype - prevHype.current[t.card.id];
          prevHype.current = Object.fromEntries(b.trending.map(t => [t.card.id, t.hype]));
          setTrending(b.trending); setDelta(d);
        } catch { /* ticker is decorative; keep last value */ }
      }
      timer = setTimeout(poll, 30_000);
    };
    poll();
    return () => clearTimeout(timer);
  }, []);

  // Optional session: own cards + pack CTA.
  useEffect(() => {
    request<{ packs: Pack[] }>('/packs').then(r => setPacks(r.packs)).catch(() => {});
    request<MeResponse>('/me').then(async m => {
      setMe(m);
      setMine((await request<{ cards: CollectionEntry[] }>('/me/cards')).cards);
    }).catch(e => { if (!(e instanceof ApiError) || e.status !== 401) setError(String(e)); });
  }, []);

  const members = useMemo(() => [...new Set([...ON_STREAM, ...trending.map(t => t.card.fazeMember)])], [trending]);
  const inFocus = (m: string) => focus.length === 0 || focus.includes(m);
  const pack = useMemo(() => [...packs].sort((a, b) => a.priceCoins - b.priceCoins)[0], [packs]);

  async function openPack() {
    if (!pack || !me) return;
    setBusy(true); setError('');
    try {
      openKey.current ??= crypto.randomUUID();           // reuse on retry → server idempotency
      const r = await request<{ cards: CardInstance[]; balance: number }>(`/packs/${pack.id}/open`, { idempotencyKey: openKey.current });
      openKey.current = null;
      setPull(r.cards); setMe(v => (v ? { ...v, balance: r.balance } : v));
      setMine((await request<{ cards: CollectionEntry[] }>('/me/cards')).cards);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open pack.'); }
    finally { setBusy(false); }
  }

  const twitchUrl = `https://www.twitch.tv/${CHANNEL}`;
  const chatSrc = parents.length ? `https://www.twitch.tv/embed/${CHANNEL}/chat?${parents.map(p => `parent=${encodeURIComponent(p)}`).join('&')}&darkpopout` : '';
  const iframeSrc = parents.length ? `https://player.twitch.tv/?channel=${CHANNEL}&${parents.map(p => `parent=${encodeURIComponent(p)}`).join('&')}&muted=true` : '';

  return <>
    {pull.length > 0 && <PackOpening cards={pull} onClose={() => setPull([])} />}
    <header><a className="brand" href="/">F<span>Λ</span>ZE <b>VAULT</b></a>
      <div className="account">{me ? <strong>{me.balance.toLocaleString()} <small>COINS</small></strong> : <a href="/">Sign in</a>}</div></header>
    <main className="watch">
      <section className="watch-head">
        <p className="eyebrow">WATCH ALONG / TWITCH.TV/{CHANNEL.toUpperCase()}</p>
        <h1>Watch live. <span>Pull what you see.</span></h1>
        <p className={`watch-status ${live}`} role="status">
          {live === 'online' ? '● LIVE NOW' : live === 'offline' ? 'OFFLINE · next stream TBA' : 'Checking stream…'}
        </p>
      </section>

      <div className="watch-ticker" aria-label="Trending card hype, simulated engagement">
        <span className="watch-ticker-label">HYPE · SIMULATED</span>
        <div className="watch-ticker-track">
          {[...trending, ...trending].map((t, i) => <span key={`${t.card.id}-${i}`} aria-hidden={i >= trending.length}>
            {t.card.name} <b>{t.hype}</b>{delta[t.card.id] ? <em className={delta[t.card.id] > 0 ? 'up' : 'down'}>{delta[t.card.id] > 0 ? '▲' : '▼'}{Math.abs(delta[t.card.id])}</em> : null}
          </span>)}
          {trending.length === 0 && <span>No trending cards yet.</span>}
        </div>
      </div>

      <div className={`watch-stage ${showChat ? 'with-chat' : ''}`}>
        <div className="watch-player">
          {!embeddable ? <div className="watch-fallback">
              <p className="eyebrow">EMBED NEEDS HTTPS</p>
              <p>Twitch only plays embedded streams on HTTPS sites. You opened this page over plain HTTP ({host}).</p>
              <a className="primary" href={twitchUrl} target="_blank" rel="noreferrer">Open twitch.tv/{CHANNEL} ↗</a>
            </div>
            : fallbackIframe ? <iframe title={`${CHANNEL} on Twitch`} src={iframeSrc} allowFullScreen />
            : <div id="twitch-player" />}
          {live === 'offline' && <div className="watch-offline-note">Stream is offline. Twitch shows recent videos here. Keep collecting below.</div>}
        </div>
        {showChat && embeddable && chatSrc && <iframe className="watch-chat" title="Twitch chat" src={chatSrc} />}
      </div>
      <div className="watch-controls">
        {embeddable && <button onClick={() => setShowChat(v => !v)}>{showChat ? 'Hide chat' : 'Show chat'}</button>}
        <a href={twitchUrl} target="_blank" rel="noreferrer">Open on Twitch ↗</a>
      </div>

      {error && <p className="alert error" role="alert">{error}</p>}

      <section className="watch-cta panel">
        <div><p className="eyebrow">WHILE YOU WATCH</p><h2>{pack ? pack.name : 'Packs'}</h2>
          <p>{pack ? `${pack.cardsPerPack} cards · ${pack.priceCoins} coins · published odds v${pack.oddsVersion}` : 'No live packs right now.'}</p></div>
        {pack && (me
          ? <button className="primary" disabled={busy || me.balance < pack.priceCoins} onClick={openPack}>{busy ? 'Opening…' : `Open now · ${pack.priceCoins} coins`}</button>
          : <a className="primary" href="/">Sign in to open a pack</a>)}
      </section>

      <section className="watch-focus">
        <h3>WHO'S ON STREAM?</h3>
        <p className="watch-hint">{ON_STREAM.length ? 'Preselected by FaZe staff for this stream.' : 'Pick the members you see.'} Tap to filter.</p>
        <div className="watch-chips">{members.map(m => <button key={m} aria-pressed={focus.includes(m)} onClick={() => setFocus(f => f.includes(m) ? f.filter(x => x !== m) : [...f, m])}>{m}</button>)}</div>
        <div className="watch-grid">
          {trending.filter(t => inFocus(t.card.fazeMember)).map(t => <MiniCard key={t.card.id} card={t.card} note={<p className="hype">HYPE {t.hype}/100 · SIMULATED</p>} />)}
        </div>
        {me && <>
          <h3>YOUR CARDS OF THEM</h3>
          <div className="watch-grid">{mine.filter(c => inFocus(c.card.fazeMember)).map(c => <MiniCard key={c.card.id} card={c.card} note={<p>{c.count} owned</p>} />)}</div>
          {mine.filter(c => inFocus(c.card.fazeMember)).length === 0 && <p className="empty">None yet. Open a pack.</p>}
        </>}
      </section>
    </main>
    <footer>FΛZE VAULT / DEMO COLLECTIBLES <span>Stream embedded from Twitch. Hype is simulated engagement.</span></footer>
  </>;
}
```

### `apps/client/app/watch/watch.css`
```css
.watch { padding-bottom: 48px; }
.watch-head h1 { font-size: clamp(32px, 6vw, 64px); margin: 8px 0; }
.watch-head h1 span { color: var(--red); }
.watch-status { font-size: 11px; letter-spacing: 2px; color: var(--muted); }
.watch-status.online { color: var(--red); font-weight: 800; }

.watch-ticker { display: flex; gap: 12px; align-items: center; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin: 18px 0; background: var(--panel); }
.watch-ticker-label { flex: none; padding: 10px 12px; font-size: 10px; letter-spacing: 2px; background: var(--red); color: #fff; font-weight: 800; }
.watch-ticker-track { display: flex; gap: 28px; white-space: nowrap; animation: watch-marquee 40s linear infinite; font-size: 13px; }
.watch-ticker-track b { margin-left: 6px; }
.watch-ticker-track em { font-style: normal; margin-left: 4px; font-size: 11px; }
.watch-ticker-track .up { color: #3ddc84; } .watch-ticker-track .down { color: var(--muted); }
@keyframes watch-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .watch-ticker-track { animation: none; overflow-x: auto; } }

.watch-stage { display: grid; gap: 12px; grid-template-columns: 1fr; }
.watch-stage.with-chat { grid-template-columns: minmax(0, 1fr) 340px; }
.watch-player { position: relative; aspect-ratio: 16 / 9; min-height: 300px; background: #000; border-radius: 8px; overflow: hidden; }
.watch-player > #twitch-player, .watch-player > iframe, #twitch-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.watch-chat { width: 100%; height: 100%; min-height: 300px; border: 0; border-radius: 8px; background: #18181b; }
.watch-fallback { position: absolute; inset: 0; display: grid; place-content: center; gap: 12px; padding: 24px; text-align: center; }
/* Not on top of the iframe (Twitch forbids obscuring): sits below the player area. */
.watch-offline-note { position: absolute; left: 0; right: 0; bottom: -28px; font-size: 12px; color: var(--muted); }
.watch-controls { display: flex; gap: 12px; align-items: center; margin: 36px 0 24px; }

.watch-cta { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin: 24px 0; }
.watch-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 20px; }
.watch-chips button[aria-pressed='true'] { border-color: var(--red); color: #fff; background: #fb294422; }
.watch-hint { color: var(--muted); font-size: 13px; }
.watch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; margin-bottom: 24px; }
.watch-card { border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: var(--panel); position: relative; }
.watch-card.rare { border-color: #419bf8; } .watch-card.epic { border-color: #b26bf3; } .watch-card.legendary { border-color: #f5be53; }
.watch-card-art { aspect-ratio: 5 / 6; overflow: hidden; border-radius: 6px; background: #111; }
.watch-card-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.watch-card h4 { margin: 6px 0 2px; font-size: 14px; } .watch-card small { color: var(--muted); font-size: 10px; text-transform: uppercase; }
.watch-demo { position: absolute; top: 12px; right: 12px; font-size: 9px; letter-spacing: 1px; background: #000a; padding: 2px 5px; }

@media (max-width: 900px) {
  .watch-stage.with-chat { grid-template-columns: 1fr; }
  .watch-chat { height: 360px; }          /* chat stacks under the player */
}
@media (max-width: 650px) {
  .watch-cta { flex-direction: column; align-items: stretch; }
  .watch-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .watch-chat { height: 300px; }
}
```

## 5. Test plan
- `http://localhost:3000/watch`: player loads (localhost is tolerated over http). When offline, status shows OFFLINE.
- `http://192.168.x.x:3000/watch`: the HTTPS fallback card appears, not a broken frame.
- `https://<tailscale-name>.ts.net/watch` or the deploy domain: player and chat load. Confirm `parent` equals that hostname.
- Script blocked (adblock): falls back to the plain iframe after 8 s or on the error event.
- Logged out: CTA links to sign in and the "your cards" section is hidden. Logged in: "Open now" debits through the server and the `PackOpening` overlay plays.
- Narrow phone (360px): player and chat stack, nothing overlaps the iframes, and the ticker respects reduced motion.

## 6. Open questions
1. Confirm `faze` as the default (official, Partner, but streams rarely). Do we want a curated fallback for offline, such as a clip (`clips.twitch.tv/embed?clip=<slug>&parent=...`) or VOD collection, set via `NEXT_PUBLIC_TWITCH_OFFLINE_CLIP`?
2. What HTTPS host will the phone demo use (Tailscale serve, Vercel, or something else)? Twitch will not embed on plain-http LAN IPs.
3. Handoff from @Jaideepo7 for `apps/client/app/watch/**` plus the nav link, and from the lead for the `.env.example` lines.
4. Live-tied drops need lead and contract approval and a server-side live check (Helix `GET /streams` with an app token held server-side).
