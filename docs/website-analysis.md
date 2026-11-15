> Research note, not part of the contract

# Sorare website reverse-engineering research

**Target:** https://sorare.com/  
**Inspected:** 2026-11-15, approximately 08:16–08:26 UTC  
**Purpose:** identify evidence-backed interface patterns worth adapting to FaZe Collector Cards.  
**Status:** research and proposed plan only. No application code, dependencies, configuration, API contracts, or product rules changed.

## 1. Executive findings

Sorare combines a visually rich acquisition page with a denser card-browsing interface. The landing page explains a progression through packs, lineups, and rewards. The public marketplace prioritizes card artwork, quick statistics, filters, and detailed card views. Its strongest transferable quality is the way the collectible remains the main visual object throughout the experience.

For FaZe, adapt the **presentation and navigation patterns**: prominent card artwork, a short introduction to the collecting loop, clear rarity and ownership information, contextual card details, mobile filter sheets, and useful search. Keep our existing FaZe identity, Next.js client, REST API, server-controlled economy, and devnet payment flow.

Sorare's auctions, cash prizes, sports-performance scoring, card XP, and token metadata are different product capabilities. Their presence on Sorare does not justify adding them to our project or implying that our existing data supports them.

## 2. Method, scope, and confidence

This was actual REA inspection, not a reconstruction from screenshots alone. REA performed declared navigation, click, text-entry, keyboard, and waiting actions. Evidence includes DOM snapshots, accessibility trees, URL changes, request metadata, selected request/response bodies, loaded JavaScript sources, delivered CSS, and screenshots.

Tools used: `capture_browser_scenario`, `list_browser_targets`, `inspect_web_page`, `inspect_analysis_view`, and `export_evidence_bundle`. Captured source and network bodies were subsequently read locally for focused analysis. A separate read-only review mapped findings to the existing FaZe client.

### Evidence labels

- **Verified—runtime:** observed through a REA action, rendered DOM/accessibility state, screenshot, or captured request.
- **Verified—source:** present in delivered JavaScript/CSS. This proves a declaration exists, not that every branch ran or every style applied to the inspected element.
- **Inferred:** a plausible explanation supported by observations, with the uncertainty stated.
- **Unverified:** not exercised, not captured adequately, or inaccessible within the signed-out scope.

### Inspection boundary

| Surface | Coverage |
|---|---|
| `/` | Desktop landing, cookie dismissal, invite-code dialog, keyboard scrolling, footer |
| `/` at 375 × 812 | Mobile landing and signup entry |
| `/?action=signup` | Initial signup form, required-name state, invite-code area; no submission |
| `/?action=signin` | Dialog shell and URL transition; settled form contents not adequately observed |
| Global search | Open, type `Pedri`, observe grouped results and network request, Escape dismissal |
| `/football/market` | Desktop and mobile public market, navigation, promotional banner, trending cards |
| Market card query | Open Pedri card, inspect detail content, Escape back to market |
| Mobile rarity controls | Open sheet, inspect options, select Rare; successful filtering not established |
| Authenticated collection, trades, lineup editor, checkout, bidding | Unverified; no account, wallet, bid, purchase, or authentication submission |

Desktop launch captures used **1440 × 900**, mobile captures **375 × 812**, device scale factor 1. These are Chromium viewport tests, not physical-phone or Safari tests. Chromium reported version **155.0.8059.84**. Launch mode used temporary profiles. Landing/scroll captures explicitly enabled normal motion; some other scenarios used REA's default reduced-motion setting. Motion conclusions therefore identify their evidence type rather than treating every capture as equivalent.

The page declared build `20261113103615` and revision `3bd919f96512e6d58353b0e800bca4e144c0a901`. These are page-provided identifiers, not an independently verified deployment history.

## 3. Layout and responsive structure

### Landing page

**Verified—runtime, E1/E2/E3:** the page hierarchy is:

1. Global header: Sorare identity, Football/NBA/MLB links, search, signup, signin.
2. Welcome-offer banner with terms and a claim action.
3. Centered hero heading and supporting explanation.
4. Manager-name entry panel with account guidance, invite-code action, and primary signup action. Desktop card artwork flanks this panel.
5. Pack introduction section with large imagery and another signup action.
6. Lineup explanation section.
7. Rewards section.
8. Community/competition section.
9. Partner/investor portraits.
10. Social links and a footer grouped into help, policies, sports, and company information.

The desktop hero uses symmetry: centered copy and entry panel, with offset collectible cards on both sides. Subsequent sections use large image-and-copy compositions. At the sampled desktop size, the first feature panel is roughly 1200px wide with approximately 110px outer margins; these are screenshot estimates, not measured computed geometry.

**Verified—runtime, E3:** the header remains visible after PageDown and Control+End. The welcome banner scrolls away. This establishes persistent header behavior in the sampled desktop route; exact `sticky` versus `fixed` implementation is not established by that observation alone.

**Verified—source, E5/E11:** the spacing scale uses an 8px base with 4, 12, 16, 20, 24, and 32px tokens. Landing source includes 450px maximum copy width, 532px maximum feature-image width, 20px upper corner radii on a feature panel, and desktop row/grid arrangements. One section declares `360px 1fr` columns and a 588px height at its laptop breakpoint. These are individual component declarations, not universal page measurements.

### Public marketplace

**Verified—runtime, E6:** the market retains the global header and adds:

- A first navigation level for exploration, scouting, and watchlists.
- A second level for auctions, instant purchases, and manager sales.
- Competition and rarity selectors.
- A large promotional card-set banner with a countdown and shop action.
- A horizontally arranged trending-auction card strip and an all-auctions link.

Cards combine large artwork with compact information: recent score, bonus, eligibility, price, secondary currency, bid count, time remaining, and an action. The captured list contained twenty card links, but only a subset was visible at once. A Next control appeared in a later state. Dragging or swiping the strip was not tested.

### Mobile adaptations

**Verified—runtime, E2/E8:**

| Element | Desktop | 375px viewport |
|---|---|---|
| Brand | Full wordmark | Compact icon |
| Sports navigation | Alongside wordmark | Separate second row |
| Welcome offer | Wide, shallow banner | Taller wrapped block |
| Hero | Entry panel flanked by cards | Full-width entry panel; flanking card clusters absent |
| Signup | Entry action available in header/hero | Signup overlay visually fills the viewport |
| Market purchase modes | Text labels | Compact icon strip |
| Market promotion | Broad composition with cards to the right | Vertically condensed composition and wide CTA |
| Rarity selection | Labeled pill in desktop header area | Separate trigger opens a bottom sheet |
| Footer | Four columns | Vertically stacked groups |

The mobile rarity trigger was below the initially visible area; REA scrolled it into view before clicking. The resulting sheet appeared over a dimmed background near the footer. Do not infer that it is a permanently fixed bottom toolbar from this capture alone.

**Verified—source, E5:** delivered JavaScript declares breakpoints at 375, 480, 720, 960, 1200, 1320, 1600, and 1800px. Landing component imports were traced to 720px and 960px media conditions. Only the two sampled viewport sizes were rendered in this investigation; behavior at every declared breakpoint remains untested.

## 4. Visual design

### Typography

**Verified—source, E2/E5/E11:**

| Role | Delivered declaration |
|---|---|
| UI/body | System sans stack: Apple system, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue, sans-serif |
| Brand font | `pressio`, then the system stack |
| Condensed brand font | `pressio-condensed`, then the system stack |
| Large brand token | Weight 500, 48px size / 48px line height, condensed brand family |
| Landing title scale | `clamp(32px, 4.8 × viewport-width-unit, 80px)` |
| Alternate larger title scale | `clamp(32px, 8.33 × viewport-width-unit, 140px)` |

Typekit CSS declares Pressio at weight 400 and Pressio Condensed at weight 500, with WOFF2/WOFF/OpenType sources. The browser requested the fonts. This establishes the font configuration and loading, rather than a computed-font audit of every glyph.

**Verified—runtime:** large uppercase condensed headings create a sports-poster appearance; compact system text handles forms, navigation, statistics, and descriptions. Landing source specifies line-height 1 for section headings and 1.7 with balanced wrapping for hero description text.

### Colors and surfaces

**Verified—source, E11:** selected CSS tokens:

| Token role | Value |
|---|---|
| Background black | `#0e0e0e` |
| Foreground white | `#ffffff` |
| Opaque dark surfaces | `#1f1f1f`, `#292929`, `#373737` |
| Secondary text | White at 66% opacity in the base dark theme |
| Limited rarity | `#f7b100` |
| Rare rarity | `#ea000c` |
| Super Rare rarity | `#179eff` |
| Unique rarity | `#ac11ff` |

**Verified—runtime:** primary header actions use purple glow; the hero signup action uses a pale lavender fill. The offer banner uses green/teal imagery and a bright green-to-yellow edge. Blue textured hero artwork, black/gold pack sections, and purple backgrounds distinguish different parts of the journey. These accent descriptions are visual observations; exact CTA computed color values were not measured.

Sorare's rarity names/colors differ from FaZe's common/rare/epic/legendary system. Reuse the principle of consistent rarity identification, not this semantic mapping.

### Backgrounds, shapes, shadows, and assets

**Verified—runtime/source, E1/E3/E5/E11:**

- Layered artwork combines backgrounds, separate card/player imagery, logos, and dark fades. It is not simply one full-page image.
- The hero entry panel is black with clipped corner styling; controls are rounded pills with subtle edge/inset highlights.
- Dark overlays and image masks maintain text legibility over dense artwork. Some source masks fade imagery over its final 10–20% of height.
- Feature sections use larger rounded corners; card/detail panels favor clear dark surfaces and compact metadata.
- A rewards heading declares `0 4px 41.5px rgba(0,0,0,0.9)` text shadow and a white/yellow/brown gradient clipped to text.
- Loaded formats include WebP, AVIF, PNG, JPEG, SVG, and WebM. Card media also appeared as media requests in marketplace captures.

In the inspected card-detail screenshot, the large left artwork region remained blank while details and statistics rendered. Its DOM/media references do not prove successful playback. Recreating a reliably loaded image fallback would be more appropriate for our project than reproducing that observed failure.

### Motion and hover

**Verified—source, E5/E11:** a landing component defines a pointer-following glow using mouse coordinates, element bounds, `--mx`/`--my`, a radial gradient, `mix-blend-mode: color`, and a 300ms opacity transition. Shared pill source includes hover/inset glows and a `0 0 16px -6px` accent shadow. Delivered CSS also contains transform/opacity transitions, selective reduced-motion rules, and smooth scrolling on some horizontal containers.

**Unverified at runtime:** actual pointer-hover response, tilt amplitude, exact transition timing, all reduced-motion states, and animation performance. The connected REA scenario action schema did not expose hover/mouse-move actions. Source declarations are not presented as exercised interactions.

**Verified—source/runtime:** global CSS declares ordinary page scrolling as `auto`; keyboard scrolling moved the page and preserved the header. No evidence here establishes scroll hijacking, parallax, or a site-wide animation library. A changing community number across early captures is not sufficient evidence of a live active-user feed.

## 5. Interactions and observable state changes

| Action | Verified result | Evidence / limit |
|---|---|---|
| Dismiss cookie prompt | Prompt disappears; browsing continues | E2/E3/E6; persistence across new sessions not tested |
| Open invite-code action | Dialog with code input and disabled confirmation while empty | E4; no code submitted |
| Try background signin while code dialog is open | Click times out; code dialog remains | E4; consistent with modal interception, not proof of a complete focus trap |
| Open signup | URL becomes `/?action=signup`; manager-name/invite-code form appears; Continue disabled when empty | E2 |
| Open signin | URL becomes `/?action=signin`; dialog and Close control appear | E10; form fields were not reliably captured |
| Open global search | Search dialog/combobox, sport buttons, grouped suggestions | E9 |
| Type `Pedri` | Results change to matching players and managers; first player result selected in AX tree | E10; public read-only query |
| Escape search | Search closes; homepage remains | E10 |
| Open a marketplace card | `?card=<slug>` added; detail dialog appears over the market | E7 |
| Escape card detail | Dialog closes; URL returns to `/football/market` | E7 |
| Open mobile rarity selector | Bottom sheet shows Limited, Rare, Super Rare, Unique and a selected indicator | E8 |
| Select Rare | Sheet closes; URL unchanged | E8b; captured list stayed Limited and no new filtering request was recorded, so successful filtering is unverified |
| PageDown / Control+End | Content scrolls; global header remains visible | E3 |

The inspected detail view includes name, season, rarity, serial/supply, XP, auction information, bid history, recent-score summaries, competition eligibility, player/team information, and token/IPFS links. This is verified public presentation; transaction processing, ownership guarantees, and chain storage were not independently inspected.

The accessibility trees expose headings, buttons, links, dialogs, tabs, combobox/listbox/option roles, and some disabled states. Several card/icon controls had empty accessible names in captured states, and some card alternatives included loading text. This was not a complete accessibility audit. Keyboard focus trapping, restoration, contrast ratios, and screen-reader usability remain open checks.

## 6. Frontend architecture and network behavior

### Verified stack and delivery

| Finding | Evidence | Confidence |
|---|---|---|
| React and ReactDOM 19.2.0 present | Version literals in captured vendor bundle | Verified—source |
| React Router present | `react-router/dom` marker; observed route/query transitions | Verified—source/runtime |
| styled-components 6.1.25 present | Vendor version marker and `data-styled-version` in DOM | Verified—source/runtime |
| Vite-generated build machinery | `__vite__mapDeps`, hashed module chunks, module preload links, build marker | Verified—source |
| Apollo Client 4.2.11 declared by requests | `extensions.clientLibrary` on observed GraphQL POST bodies | Verified—runtime, client-reported identity |
| GraphQL API | POST requests to `https://api.sorare.com/graphql` | Verified—runtime |
| Algolia search | POSTs to `https://7z0z8pasdy-dsn.algolia.net/1/indexes/*/queries` | Verified—runtime |
| Separate asset delivery | `assets.sorare.com`, `frontend-assets.sorare.com`, same-origin hashed assets | Verified—runtime |
| Feature/config and telemetry services | LaunchDarkly, Segment, and Sentry requests | Verified—runtime; exact purpose of every event not audited |
| Localization delivery | Revision-addressed `en.json.gz` request and language alternatives in DOM | Verified—runtime |

A `#root` mount, dynamic chunks, router markers, and query-driven dialogs support describing the observed frontend as a React application with client-side navigation. Its original component tree, repository layout, backend language, database, deployment topology, and complete rendering strategy are **not established**. This inspection does not identify it as Next.js.

### Observed request/state mapping

| Trigger / state | Request evidence | What it establishes |
|---|---|---|
| Landing initialization | `ConfigQuery`, `WalletLandingQuery`, `LandingPromoBannerQuery`, `AnySportPastLineupWinnerQuery` | Landing obtains configuration and content through GraphQL; exact UI ownership is partly inferred from names/source |
| Signup opened | `EnterCodeInlineQuery`, `SignupLeaguesQuery` | Additional read queries accompany signup entry; no account-creation mutation was submitted |
| Market initialization | `MarketHomePageQuery` with `sport: FOOTBALL`, empty competition slug, `rarity: limited`; `CurrentMarketplaceUserQuery`; `MatchdayPicksTabQuery` | Market reads its initial context and content |
| Trending cards | Algolia `CardsOnSale_BidsCount`, `hitsPerPage=20`, primary/on-sale/football/Limited filters; then `CardsShowQuery` with card slugs | Search indexing and card detail hydration are both observed; ordering suggests a two-stage fetch, but initiator causality was not captured |
| Card clicked | `AnyCardDialogContentQuery` with `slug: pedro-gonzalez-lopez-2026-limited-549` during open-card step | A specific card-detail read accompanies the URL-backed dialog |
| Search typed | Algolia multi-index request with `query=Pedri`; Player, Club, NationalTeam and other result groups | Search is network-backed; it is not just filtering the visible card strip |

GraphQL request bodies contain `operationName`, `variables`, and an `extensions.operationId` beginning with `React/`. This is consistent with registered/persisted operations; server enforcement and fallback behavior were not tested. Do not treat operation names as recovered complete GraphQL schemas.

REA records step attribution and receipt order. That is useful for correlating clicks and requests, but is not a JavaScript initiator stack or proof of exclusive causality.

The first desktop landing capture recorded 46 requests, all returning 2xx within that window. One market capture recorded 216 transactions, including 166 script requests and one unfinished request. These are capture-specific counts, not Lighthouse results or stable production performance budgets. The large difference is consistent with additional market chunks/features, but the exact cause of every chunk load is not established.

### Component/state model inferred for reconstruction planning

The observations suggest these useful boundaries: global shell; sport navigation; promotional banner; signup entry; modal/dialog manager tied to URL state; card display; card-detail content; grouped search; filter controls; and marketplace result strips. These are **proposed conceptual boundaries**, not recovered original source filenames.

Landing source also contains a current-set/previous-set branding fallback and a loading branch when data is absent. That is verified source behavior; all fallback/error states were not exercised.

## 7. What we should adapt for FaZe

The following are proposals, not approved product changes or claims about completed work.

| Pattern from Sorare | FaZe adaptation | Existing support / boundary | Priority |
|---|---|---|---|
| Collectible artwork drives the layout | Larger consistent FaZe cards in store previews, collection, reveal, and trade selection | Existing `CardView` and `artUrl`; use our own approved art | High |
| Short, visual progression on landing | Explain collect → open → trade → rank; highlight the real 500 **demo** starter coins | Existing signup and demo rules | High |
| Compact shell plus focused content | Keep navigation/balance accessible; reduce repeated hero space inside signed-in task screens | Client presentation work | High |
| Search and rarity controls | Name/member search, rarity filter, duplicate-only and unlocked filters | Can filter `/me/cards` locally; no need for Algolia at current scale | High |
| URL-backed card details | Deep-linkable detail state with Escape, close, focus return, and retained collection context | `/cards/:id` already exists; URL behavior is a client decision | High |
| Responsive mobile filters | Short trigger opens a sheet with clearly labeled options and active-filter summary | Client presentation work; verify results actually update | High |
| Concise card stats | Rarity, member, hype, serial, duplicate count, locked state, demo label | Existing fields; no invented market valuation or sports scores | High |
| Prominent pack artwork and CTA | Focused pack offer, published odds and cost, then a server-result reveal stage | Existing `/packs` and open endpoint | High |
| Rich detail hierarchy | Artwork alongside hype, supply, serial/context and next action | Existing detail/collection payloads | Medium |
| Grouped search results | Separate owned cards from approved trade-user matches | `/users?q=` supports user search; broad public card search is not in the contract | Medium |
| Competition/trending presentation | More legible collector ranks and trending FaZe cards | Existing `/leaderboard`; hype remains explicitly simulated | Medium |
| Selected-card visual treatment | Thumbnail trade pickers and a two-sided offer review | Existing trade APIs and locked-instance fields | Medium |
| Selective glow and motion | Brief rarity feedback, clear hover/focus, restrained reveal effects | CSS can suffice; reduced-motion and skip/recovery states required | Low after core UX |

### Reuse boundary

Reuse general interaction patterns and independently implement them using our components and assets. Sorare's bundles, card designs, player photographs, logos, branded backgrounds, copy, and hosted font files are reference material, not project assets supplied with permission to reuse. Use an appropriately licensed font if a similar condensed display style is selected.

Do not copy their monetary welcome offer, claimed community totals, testimonials, cash rewards, ETH displays, fantasy lineups, or auction mechanics into the FaZe demo. Our offer is 500 demo coins; our purchases use Phantom on Solana devnet; coins cannot cash out; our hype is simulated.

Do not migrate our application to GraphQL, Algolia, Vite, or styled-components merely because Sorare uses them. The transferable benefit is the interaction design. Our present Next.js/React client and REST contract can support most of the high-priority proposals.

## 8. Current FaZe baseline

This section is verified from local source, not a runtime audit of the FaZe app.

- `apps/client/app/page.tsx` uses local tab state for Store, Collection, Trades, Leaderboard, and Coins. A shared hero remains above the views. `CardView` is reused across several surfaces.
- The collection already groups by set ID, supports rarity filtering, and shows duplicates, serials, and locks. Human-readable set names are not supplied by that grouping; do not replace truncated IDs with invented names.
- Card details already fetch `/cards/:id` into a modal. Source review did not find complete Escape, focus-trap, focus-restoration, and background-scroll-lock behavior.
- Packs already show odds and use a server-returned pull. Reveal CSS staggers cards. The open request retains an idempotency key for retry behavior.
- `apps/client/app/trades.tsx` already supports approved-user lookup, both collections, locked-card exclusion, messages, and incoming/outgoing actions.
- `apps/client/lib/phantom.ts` implements the existing devnet checkout/confirmation flow and recovery. Improve its presentation without changing server confirmation semantics.
- Current CSS uses background `#090a0c`, panels `#121418`, accent `#fb2944`, gray borders, system sans text, and common/rare/epic/legendary accents. At 650px cards become two columns and several layouts stack.

This supports an incremental frontend improvement plan. A full Sorare clone would add unrelated scope and discard already-working product behavior.

## 9. Proposed implementation sequence — not executed

1. **Choose scope with the lead.** Review the high-priority adaptations on the message board. Decide whether the public landing/store preview is part of the demo scope. Keep auctions, lineups, real rewards, and new data fields outside this proposal unless separately approved.
2. **Record the visual direction.** Preserve FaZe dark/red identity; define card sizes, type hierarchy, spacing, rarity treatment, and approved imagery. Prepare desktop and 375px compositions for landing, collection, and detail. Exact Sorare dimensions are references, not mandatory values.
3. **Refine the application shell and onboarding.** Distinguish the signed-out explanation from signed-in task screens. Keep balance, navigation, and demo context visible. Connect the signup-to-first-pack path using existing endpoints.
4. **Improve the shared card presentation.** Establish artwork loading/error treatment, stable aspect ratio, readable rarity/member information, duplicate counts, and lock/selection states. Reuse it in collection, reveal, trending, and trades.
5. **Improve collection discovery.** Add local search/sorting and useful filters using existing payloads. Provide separate empty-collection and no-matches states. Make mobile controls explicit and verify every filter changes results.
6. **Improve card details and navigation.** Introduce a reviewed URL/deep-link strategy, accessible modal/sheet behavior, contextual actions, and appropriate desktop/mobile hierarchy. Preserve scroll and selection context on return. Verify Back, Escape, focus return, and direct-link loading.
7. **Refine pack purchase and reveal.** Keep price/odds/version clear before opening. Render only cards returned by the server; preserve idempotent retry behavior. Add deliberate reveal pacing, skip/reduced-motion paths, and a direct route to the collection.
8. **Refine trades, ranks, and payment feedback.** Use visual card selectors and a two-sided review for trades; preserve locks and atomic server actions. Clarify leaderboard score/hype labels. Show wallet/sign/send/confirm/recovery states without crediting before server confirmation.
9. **Verify the full demo journey.** Check desktop, 375px and intermediate widths; long names, missing art, empty data, loading/errors, keyboard use, dialogs, reduced motion, insufficient coins, locked cards, payment rejection and pending confirmation. Run the repository-required typecheck/tests when implementation exists. No implementation test suite is needed for this research-only document.

All implementation belongs in the relevant owner's area. Most proposed presentation work is in `apps/client/`. Human-readable set metadata, new backend queries, auction systems, or other contract changes require lead coordination. This plan does not authorize those changes.

## 10. Limitations and follow-up inspection

- Research covers signed-out public pages, not the full Sorare product. Pack opening was explained by the landing page but not executed. Private trading, owned collection management, wallet connection, payment confirmation, and lineup editing remain unknown.
- An early connected-browser signin capture failed after partial observation. Later launch-mode capture verified the URL/dialog shell but not a usable signin form. Do not infer its inputs, validation, or authentication protocol from common conventions.
- One card selector matched twenty links; that attempted click failed. A subsequent exact-slug selector successfully opened the intended card. Failed attempts are not counted as successful interactions.
- A mobile attempt used the desktop rarity label and timed out. The mobile-specific trigger worked. Selecting Rare closed the sheet but did not establish a changed result set or filter request within the capture window.
- Several network captures are marked incomplete because selected bodies were unavailable or requests were unfinished. Recorded DOM/actions can still be complete individually. No capture establishes all requests or every background event.
- REA response-body capture uses Playwright's body API; the provider warns bytes may come from a follow-up load and are not guaranteed wire-original bytes. Static CSS findings refer to delivered bytes, not a wire-level attribution claim.
- Script-source capture exceeded the MCP inline response budget. The complete retained evidence was exported and read locally; it was not silently treated as absent.
- CSS capture initially exceeded allocation budgets. A focused stylesheet-only capture with sufficient declared budgets succeeded, returning a complete 725,105-byte stylesheet.
- Captured styles were not evaluated through a complete computed-style or bounding-box audit. Exact component pixel geometry, all hover states, animation frame timing, browser differences, full focus management, and performance metrics remain unverified.
- Feature flags, content rotation, time-sensitive auction data, locale and login state can change the experience. Prices and timers in captures are historical observations, not current quotations or values to reproduce.

If a later implementation needs more fidelity, the next useful research is a consented authenticated walkthrough of collection, pack reveal and trade flows; targeted desktop/mobile focus and hover testing; and computed-style measurements of the selected components. These are follow-up research tasks, not blockers to adapting the already-verified public patterns.

## 11. Evidence index and reproducibility

Primary pages: [landing](https://sorare.com/), [football market](https://sorare.com/football/market), and [inspected card context](https://sorare.com/football/market?card=pedro-gonzalez-lopez-2026-limited-549). Live pages will change; the retained evidence below is the basis of this report.

| Ref | REA parent evidence ID | Contents |
|---|---|---|
| E1 | `ev_de9bfe628198f2fe159d5a0783cb355e857eaa114974496da45c8f17b4ca2350` | Desktop landing, initial network, DOM, screenshot |
| E2 | `ev_b068b113a08d402052ce6f229f909151f148da69018cc4b06d909d0671ac82a5` | Mobile landing and signup; Typekit response |
| E3 | `ev_cb38c63bade00bf05b342b8e0a369dd5b59956d641157374f40a0f9ffc329787` | Desktop PageDown and footer states |
| E4 | `ev_da82e7deba5fb281edccc05f14af9e28e8623747d2a6b0d0ca9b2fb801a12eb1` | Invite-code dialog; subsequent blocked click |
| E5 | `ev_574d8b56bb0cd1518aa92ea1ec6f7f61e2ac0952dfbdf6b47daf706bf5a0ee63` | Passive page/source inventory with loaded JavaScript |
| E6 | `ev_5c1e27a898461b601afdd42683d7532e8c4da69ea3c4b6277de6917e2006f545` | Desktop public marketplace |
| E7 | `ev_6e38e8cdc83fd0738ab1f3b43283d80bff902e9ca162fd143f308223c56d25c8` | Card click, detail query and content, Escape |
| E8 | `ev_4432d5a02a78ad4cc413dad5b6b45eb5005cf53f29a28f14b73a20213fb317c5` | Mobile market and rarity sheet |
| E8b | `ev_059ced2f94aafe7a973ea7c8db965e074cc03799c092974f9b29923e9992893c` | Rare selection, bounded inconclusive filtering result |
| E9 | `ev_fa6d69e500ee57c87cd83273a8912be872d8ec5a034367b30f8ae1518af7946e` | Initial global search suggestions |
| E10 | `ev_fd4818923971449a87c49772e9696331deda0807f4feb8a5fe30a142973245af` | Typed search, Algolia request, Escape, signin shell |
| E11 | `ev_150db5a4febc8dd43de55a008b667d67b0547a7d1681e3f17e18c4085c6e0fe1` | Complete delivered global stylesheet |

Evidence bundle: `/tmp/sorare-rea-evidence.json`. This is a local research artifact, **not committed**, and `/tmp` is not durable storage. Copy it to an appropriate research archive before clearing temporary files if further inspection is needed. It includes captured third-party source and images for analysis, not assets to ship in FaZe.

Useful source identities:

- Global CSS `/assets/style-BC-rG5Zj.css`: SHA-256 `7a6cbb3e664263ec2dbaf6580b44cbe54ddf5b4a265d4f9719edb1baf467805e`.
- Vendor `/assets/vendor-CBSzMgfS.js`: captured CDP hash `b309c6aedaf622b7f70485e0bb2e9561d40dbe8287dd988bf6e0224ee134bd12`.
- Main `/assets/index-Bv9X7na0.js`: captured CDP hash `db4d3e3d5ada68496c1aa9becd748ebed178a28f5dc144146d0d8760b9198043`.
- Landing `/assets/index-BLcwLYoB.js`: captured CDP hash `674f7758068421be0ec3a4d6ec2e5a083ba6006d3764807796c741ce81b44728`.
- Typekit `/uog4qjf.css`: captured body SHA-256 `a2215bad9ef58e07e0e3d65ab91edb87e8ec334ddc37e86cc806aa4bc28e32e1`.

For a repeat inspection, launch a fresh temporary browser at the stated viewport, load the route, wait for initial content, dismiss cookies, and repeat the named actions. Use the exact observed card URL rather than an ambiguous selector. Capture DOM/accessibility/URLs per step and request bodies for GraphQL/Algolia correlations. Keep source-only conclusions separate from action outcomes and retain the tool's omission/coverage metadata.
