# Fan client

From repository root install dependencies, then run `npm run dev -w @faze/client` (port 3000). Start the API on 4000 and payments on 4100. The API must allow `http://localhost:3000` in its CORS client origins; payments uses CLIENT_URL for the same origin. Use the same hostname for all services so the session cookie is shared.

Public environment configuration, also to be listed in root `.env.example`:
- `NEXT_PUBLIC_API_URL` defaults to `http://localhost:4000`.
- `NEXT_PUBLIC_PAYMENTS_URL` defaults to `http://localhost:4100`.

No database credentials or wallet private keys belong in the client. The browser uses the public Solana devnet RPC. Payments are labelled TEST/DEVNET and require Phantom set to Solana Devnet with enough faucet SOL for payment and fees. Only server-confirmed payments update the balance. Pending purchases can be checked after a reload without sending another payment.

All displayed pulls, balances, trades, odds and hype come from the server. The collection groups by set ID (public contract does not supply set names) and rarity; card details show server hype and supply. Demo cards/coins and simulated hype are labelled. Publishing a new set becomes visible when the store is refreshed.

Validation: `npm run typecheck -w @faze/client`; `npm run build -w @faze/client`. If using a cross-worktree node_modules junction, Turbopack's hermetic root check may reject it; use `next build --webpack` for that local check. Normal installs support the default build.

Manual full-stack smoke test:
1. Sign up and verify 500 demo coins; log out and back in.
2. Open a pack, check server-returned rarities/serials in the reveal and Collection. Repeat after a failed request using Retry opening; the same key is retained to avoid a duplicate charge.
3. In two browser profiles, open packs, approve the users' names through admin, find the other collector, send an offer, then accept it from the recipient. Check both collections and locked-state changes.
4. Buy a demo bundle with Phantom on devnet. Confirm pending progress then server balance/history; reload during confirmation and use Check payment.
5. Visit Leaderboard, trigger an admin engagement spike, then refresh and check simulated hype changes.
6. Check 375px width, keyboard navigation, reduced motion, API errors, insufficient coins, and Phantom cancellation. A live devnet payment needs a funded test wallet and has not been claimed by static build checks.
