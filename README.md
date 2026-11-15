# ClipDeck

Collect the moments. Build your deck. Play your fandom.

## 💡 Inspiration

An impossible clutch. An iconic trickshot. A stream reaction everyone remembers.

These moments turn viewers into FaZe fans, but they quickly disappear into endless feeds. We built ClipDeck to give them a lasting home: digital cards fans can collect, trade, and use in a strategy game.

## 🃏 What it does

ClipDeck is a collectible card platform built around FaZe moments. It connects the fan experience with staff tools for creating and publishing new collections.

- Open packs: Discover individually numbered cards through animated reveals, with rarity odds published before purchase.
- Build a binder: Explore collections organized by era and set, including previews of cards you have yet to collect.
- Trade with fans: List cards publicly and propose exchanges with other collectors.
- Play Clip Clash: Choose five different cards and compete against a friend or CPU. Each round presents a prompt; matching your card’s tags to that prompt earns points. Suitability determines the score, rather than rarity.
- Watch and contribute: Watch Twitch streams, VODs, and clips, then submit moments for staff review. Approved contributions can receive optional devnet SOL rewards.
- Manage new drops: Staff use the Control Room to discover opportunities, draft cards, review rights, publish packs, and track activity.

Demo scope: Payments and contribution rewards use Solana devnet test SOL, with no real monetary value. Demo content and simulated engagement are labeled.

## 🛠️ How we built it

We built a TypeScript and JavaScript monorepo with Next.js and React for the interface, Fastify for backend services, and shared Zod schemas for validation.

### The collection and payment flow

1. Quote: The server creates a pack purchase quote with the price, payer wallet, treasury address, and unique payment reference.
2. Sign: The fan approves the transfer in Phantom. Private keys remain inside the wallet.
3. Verify: The backend checks Solana devnet for a finalized, successful transaction with the expected signer, reference, recipient, and exact transfer amount.
4. Deliver: The server generates the pack and saves its cards, pull record, and purchase completion in one database transaction.
5. Recover: Saved receipts let fans check interrupted purchases. Repeated confirmations return the same cards, preventing duplicate delivery.

### Tiger Data: persistent ownership and game state

Tiger Data’s managed PostgreSQL service stores collections, artwork, trades, purchases, and Clip Clash matches.

Transactions, row locks, and unique constraints protect ownership. Trades update both collectors’ cards atomically, while reservations prevent conflicting marketplace, trade, and gameplay actions.

Architecture distinction: Card ownership lives in PostgreSQL. Solana verifies payments and contribution rewards.

### The content pipeline

Source moment → frame extraction → suggested crops → staff draft → review → published set

- FFmpeg extracts video frames.
- Sharp processes card images.
- YuNet through ONNX Runtime detects faces locally to suggest crops.
- Staff review confirms context and rights before publication.

The Control Room also ranks archive moments using explainable signals: anniversary timing, member momentum, collector demand, catalog gaps, and archive significance.

### Clip Clash

The server snapshots each lineup’s artwork and tags, scores cards against weighted prompts, and returns an explanation of the matching tags. Frontend animations reveal the result; the server determines the outcome.

## 🧩 Challenges we ran into

- Conflicting ownership actions: A card could be offered in a trade while being selected for gameplay. We added shared reservations and transactional checks.
- Payment retries and interruptions: Blockchain transfers and database fulfillment happen separately. Persisted signatures and repeat-safe confirmation make purchases recoverable.
- Meaningful gameplay: We developed curated tags and transparent prompt scoring so card selection matters beyond rarity.
- Browser capture restrictions: Twitch embeds limit direct frame access. We supported approved tab capture and screenshot uploads as a fallback.
- Parallel development: Shared contracts and forward database migrations helped keep the frontend, API, payments, and content tools aligned.

## 🏆 Accomplishments that we're proud of

- One connected experience: Watching, collecting, trading, playing, and contributing share the same card ecosystem.
- Recoverable checkout: Verified payments connect to transactional card delivery and saved purchase records.
- Explainable gameplay: Players can see which tags earned points in Clip Clash.
- A complete publishing workflow: Staff can take a source moment through drafting, rights review, publication, and analytics.
- Community participation: Fans can propose the moments that deserve a place in future collections.

## 📚 What we learned

Reliability shapes trust. Recovering a purchase and protecting a trade matter as much as the pack reveal.

Blockchain and relational databases serve complementary roles. Solana verifies transfers; PostgreSQL maintains ownership and application state.

Gameplay should reflect the collection. Using the meaning of each moment in scoring gives fans another reason to care about their cards.

Automation benefits from human judgment. Detection and recommendations help prepare content, while staff remain responsible for approval.

## 🚀 What's next

- Community-shaped drops: Connect approved submissions directly to publishing, preserving source information and contributor credit.
- More Clip Clash testing: Refine balance, multiplayer reconnect behavior, and match cleanup.
- Automatic purchase reconciliation: Complete verified orders without requiring fans to check manually.
- Faster media delivery: Improve caching as the catalog grows.
- Seasonal sets and shareable binders: Give fans more ways to collect together and showcase their favorite moments.
