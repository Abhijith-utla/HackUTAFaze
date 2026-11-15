# /brag plan — FaZe Collector Cards

**What it is:** a fan app where you open packs of digital FaZe trading cards, build a collection, trade with other fans, and buy coins with a Phantom wallet on Solana devnet.
**For:** FaZe fans. **What it does for them:** the pack-rip rush, a collection to flex, trades with friends.
**Sets it apart:** odds are printed on the pack and rolled on the server; payments are verified on-chain before a single coin lands; trades swap both sides or nothing.
**Most impressive claim:** "Odds on the box. Rolled on the server." (the app's own copy: "Odds v1, rolled on the server.")
**Visual hook:** a red foil pack shaking on the beat, then ripping open in a red flash.
**Real UI shown:** store pack card with the real odds table (70 / 20 / 8 / 2), pack reveal with the real `CardTile` look and real seed art, Buy coins card with real bundle (1000 coins · 0.05 SOL) and the app's real status strings, the trade flow, the header balance.
**Tone:** FaZe-themed esports hype — black and red, heavy italic type, hard cuts on the beat, glitch flashes. Closest preset: `cinematic` × `chaotic`, but readable.
**Share caption:** see `share-copy.txt`.

**Identity (from `apps/client` on `agent-c/client`):** `--bg #0b0b0d`, `--panel #16161a`, `--line #2a2a31`, `--text #f2f2f4`, `--mute #9a9aa6`, `--red #e10600`; rarity borders common `#777`, rare `#3b82f6`, epic `#a855f7`, legendary `#f59e0b` + glow; font `system-ui` (bold italic for display); wordmark "FAZE CARDS". Card art: Keshav's original geometric seed SVGs from `content/seed/art/`.

**Honesty:** no FaZe logo or official branding — the product's own "FAZE CARDS" wordmark only, with "Built for HackUTA 2026 · FaZe track" and "Demo · devnet coins have no cash value" on the outro. Card names are the demo catalog's. The wallet sheet is a plain approval panel labelled "Phantom" in text (no Phantom logo). No real user data; usernames shown are fictional ("fan1", "fan2").

## Tempo

150 BPM, A minor (Am – F – C – G, one chord per bar). 1 beat = 0.4 s = 12 frames @ 30 fps. 48 beats = 19.2 s. Every cut lands on a beat.

## Storyboard (beats → seconds)

| # | Beats | Time | Scene | On-screen text (read time) |
|---|---|---|---|---|
| 1 Hook | 0–6 | 0.0–2.4 | Black. Red light sweep. Sealed red foil pack "FAZE CARDS · OG ERA DEMO PACK" thumps on every beat, scale-punches; riser. Rips on beat 5 → red/white flash. | "OPEN THE PACK." (3 words, ~1.6 s) |
| 2 Reveal | 6–14 | 2.4–5.6 | Five real cards flip in one per beat (common, rare, epic, rare, **legendary**). Legendary lands last with gold glow, "LEGENDARY" stamp, serial #7. Then headline. | "COLLECT. OPEN. TRADE." (app's own tagline, 1.2 s) |
| 3 Odds | 14–22 | 5.6–8.8 | Store pack card; odds rows tick in on beats (common 70%, rare 20%, epic 8%, legendary 2%); "Odds v1, rolled on the server." | "ODDS ON THE BOX. ROLLED ON THE SERVER." (2.4 s) |
| 4 Pay | 22–32 | 8.8–12.8 | Buy coins card → cursor clicks **Buy** on 1000 coins · 0.05 SOL → wallet approval sheet → "Waiting for on-chain confirmation…" → "Payment received (devnet, demo coins)." Header balance counts 500 → 1,500. Badge "SOLANA DEVNET · TEST FUNDS". | "PAY WITH PHANTOM. VERIFIED ON-CHAIN." (2.4 s) |
| 5 Trade | 32–40 | 12.8–16.0 | fan1 and fan2 collections side by side; epic slides right, rare slides left, "Trade accepted" toast; both counts update. | "TRADE YOUR PULLS WITH OTHER FANS." (2.4 s) |
| 6 Outro | 40–48 | 16.0–19.2 | Giant italic "FAZE CARDS", red slash wipe, legendary card floating behind. | "COLLECT. OPEN. TRADE." + small "Built for HackUTA 2026 · FaZe track · Demo — devnet coins have no cash value" (3.2 s) |

Transitions: hard cuts on the downbeat with a 2-frame red flash / chromatic split (FaZe glitch), never a crossfade between busy layouts.

## Sound

Synthesized in-page (WebAudio, offline render), one piece on the 150 BPM grid from frame 0: sub kick four-on-the-floor from beat 6 (heartbeat kicks on 0, 2, 4 during the hook), clap on beats 2 & 4, closed hats on 8ths, saw bass following Am–F–C–G with kick ducking, short supersaw stabs on scene cuts. SFX in key and under the music: pack thumps = the hook kicks, rip = band-passed noise burst on beat 5, card flips = short filtered noise swishes on each reveal beat, legendary = A-minor arpeggio shimmer, coin counter = soft ticks on 16ths, trade = whoosh pair. Master: gentle compression + limiter, peaks ≈ −1 dBFS.

## Build

Canvas 2D in system Chrome, every frame a pure function of `t`; real seed SVGs drawn as images (preloaded before capture). WebCodecs H.264 + AAC, muxed with `mp4-muxer`, driven by `playwright-core` (no ffmpeg on this machine). Poster = settled outro frame, baked in as frame 0.
