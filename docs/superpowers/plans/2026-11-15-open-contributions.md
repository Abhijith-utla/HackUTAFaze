# Open Contributions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give FaZe staff a two-tab admin with working community card review and verified devnet contribution payouts.

**Architecture:** Preserve the existing Next.js admin shell, but reduce its primary navigation to Analytics and Open Contributions. Add an API-owned proposal/payout model and server-side devnet verifier; the browser constructs and signs transfers with Phantom, while the server records only verified results.

**Tech Stack:** Next.js 16, React 19, Fastify, PostgreSQL, Zod, `@solana/web3.js`, Phantom, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-open-contributions-design.md`

## Global Constraints

- Use Solana devnet only; reject mainnet and never keep a private key server-side.
- One contribution gets at most one verified payout.
- Preserve existing pack-payment and specialist-admin routes.
- Label seeded content and transfers demo.
- The primary admin navigation has exactly Analytics and Open Contributions.

## Review Focus

- A proposal already paid or a reused signature cannot be paid again — task 2 tests it.
- A transaction missing the quote reference, payer, recipient or exact minimum amount cannot confirm — task 2 tests each check.
- A rejected proposal never exposes the payout path — task 3 tests UI/API state.
- Phantom cancellation or a slow devnet confirmation provides recoverable status rather than a false paid result — task 3 tests the client helper state.
- Mobile navigation retains the two tab controls without a horizontal overflow — task 1 receives a responsive browser/manual check.

### Task 1: Two-tab shell and Analytics route

**Files:**
- Modify: `apps/client/app/admin/control/_components/ui.tsx`
- Modify: `apps/client/app/admin/control/control.css`
- Modify: `apps/client/app/admin/control/page.tsx`
- Modify: `apps/client/app/admin/control/analytics/page.tsx`

**Interfaces:**
- Produces: `Analytics` and `Open Contributions` primary navigation targets.

- [ ] Write a small render/navigation test or route assertion for the two primary tabs.
- [ ] Verify it fails against the existing multi-section navigation.
- [ ] Make `/admin/control` Analytics and move the contributions target to `/admin/control/contributions`; retain old specialist routes without primary-nav entries.
- [ ] Add responsive, keyboard-visible tab styling and verify the route builds.
- [ ] Commit the tab-shell change.

### Task 2: Contribution and payout API

**Files:**
- Create: `services/api/migrations/010_contribution_proposals.sql`
- Create: `services/api/src/contributions.ts`
- Create: `services/api/src/routes/contributions.ts`
- Modify: `services/api/src/app.ts`
- Modify: `services/api/src/config.ts`
- Modify: `services/api/package.json`
- Modify: `docs/api.md`
- Modify: `docs/data-model.md`
- Test: `services/api/test/contributions.test.ts`

**Interfaces:**
- Produces: `GET|POST /admin/contributions`, `POST /admin/contributions/:id/approve|reject|payouts|payouts/confirm`.
- Consumes: admin session, proposal recipient wallet, `PayoutQuote { id, reference, recipient, lamports, cluster: "devnet" }`.

- [ ] Write failing tests for approval state, one payout quote, transaction-verification rejection paths and one successful confirmation.
- [ ] Verify tests fail before the route/model exists.
- [ ] Add the additive migration and admin-only API routes with transaction/audit boundaries.
- [ ] Add pure devnet transfer verification and the RPC confirmation adapter; reject replayed signature and mainnet configuration.
- [ ] Run focused tests and commit the API/model change.

### Task 3: Open Contributions surface and Phantom payout helper

**Files:**
- Create: `apps/client/app/admin/control/contributions/page.tsx`
- Create: `apps/client/lib/contribution-payout.ts`
- Modify: `apps/client/app/admin/control/control.css`
- Test: client-focused helper test if the existing client test harness can run; otherwise a live devnet-disabled API/route proof is recorded.

**Interfaces:**
- Consumes: task 2’s contribution list, decision and payout endpoints.
- Produces: direct card creation through existing `/admin/cards`, decision UI and a signed `PayoutQuote` confirmation.

- [ ] Write the failing helper/API interaction test for a rejected wallet signature or unresolved payment.
- [ ] Implement a minimal two-mode page: Add card and Community queue, with labelled decision/payment status and live-region feedback.
- [ ] Reuse the app’s existing Phantom connection and System Program transfer approach; no wallet key is stored in browser storage or server.
- [ ] Verify the page at desktop and 375px, including keyboard focus and reduced motion.
- [ ] Commit the UI/helper change.

### Task 4: Integration proof and review

**Files:**
- Modify: `services/api/src/seed.ts` only if deterministic demo proposals are required for the running demo.
- Test: `services/api/test/contributions.test.ts`

**Interfaces:**
- Consumes: tasks 1–3 routes, model and client flow.

- [ ] Seed clearly labelled demo proposals if an empty development database would otherwise hide the queue.
- [ ] Prove list → approve → payout quote → mocked verified confirmation → paid, plus reject and replay rejection paths.
- [ ] Run the focused gates, typechecks and diff review; record unrelated baseline failures.
- [ ] Commit verification-only seed/test additions.

## Self-review

The plan maps each requested admin outcome to a task: two-tab simplification (1), direct card entry and community applications (3), approve/reject (2–3), and wallet-to-contributor rewards (2–4). It intentionally does not deploy an Anchor program because the supplied repository’s current program is a raffle and cannot safely implement escrow approval. The client never marks a payout paid on its own; task 2 owns the authoritative state transition.
