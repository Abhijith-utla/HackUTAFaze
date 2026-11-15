# Agent C — Fan client (web + mobile) — @Jaideepo7

Owns: `apps/client/` (Next.js, responsive so it works as the mobile experience).
Consumes: `docs/api.md` via `packages/shared` types. Never computes pulls, odds, balances or trade results locally.

## Features
1. **Auth screens** — signup, login, logout; balance in the header from `GET /me`.
2. **Store** — pack list with price and published odds table; buy-coins button (calls B's checkout) and success/cancel pages.
3. **Pack opening** — animation that reveals the cards the server returned, rarity effects, "demo" label on demo coins.
4. **Collection** — grid by set/rarity, duplicate counts, serials, card detail page with hype stat.
5. **Trades** — pick a user, choose cards on both sides, send offer; inbox to accept/decline; status updates.
6. **Leaderboard** — top collectors and trending (highest hype) cards.
7. **Polish** — FaZe branding (dark, red accent), loading/error states, works at 375px width.

## Done when
- Every demo step (master.md §2, steps 1–6) can be clicked through in the browser against the real API.

## Coordinate
- Build against a mock of `docs/api.md` until @toosh-legacy posts that endpoints are live.
- Checkout flow with @Abhijith-utla. Card art URLs come from @tanejakeshav's content pipeline.
