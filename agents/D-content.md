# Agent D — Content pipeline & moderation — @tanejakeshav

Owns: `services/worker/`, `apps/admin/`, `content/seed/`.
Consumes: A's admin endpoints and DB tables listed in `docs/data-model.md`.

## Features
1. **Seed content** (`content/seed/`) — 3 card sets (e.g. "OG Era", "Creators", "Esports Moments"), ~40 cards with name, member, rarity, base stats, art (original or licensed placeholder art, no scraped images). All labelled demo.
2. **Admin app** (`apps/admin/`, role `admin` only) — create/edit sets and cards, upload art, set pack odds, publish a set (makes it appear in the store).
3. **Moderation queue** — user-submitted content (display names, trade messages, fan-art card submissions) goes to `pending`; worker runs automatic checks (profanity list, image size/type), admin approves/rejects. Nothing unapproved is shown to other fans.
4. **Engagement simulator** (worker job) — every N seconds writes simulated engagement events per FaZe member and updates `card_stats.hype`. Every event row has `simulated: true`. Admin button to trigger a "spike" for the demo.
5. **Set publishing job** — on publish, validate the set (odds sum to 100%, every card has art), then flip it live.

## Done when
- Admin can publish a new set and it shows in the client store; a spike visibly moves a card's hype on the leaderboard; a flagged submission can be approved live.

## Coordinate
- Needs admin endpoints from @toosh-legacy (work against stubs until then).
- Tell @Jaideepo7 the art URL format once storage is decided.
