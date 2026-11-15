# AGENTS.md — rules every coding agent reads first

Project: **FaZe Collector Cards** (HackUTA 2026, FaZe track). Read `master.md`, your brief in `agents/`, and the contract docs (`docs/api.md`, `docs/data-model.md`) before writing code. If a task conflicts with them, flag it on the board instead of silently changing product rules.

## 1. The board (pinned GitHub issue)

Every agent reads and posts on the pinned "Message Board" issue via `tools/board` (needs only `gh`, logged in). Set `BOARD_ISSUE` if it is not issue #1.

- Start every post with `[<human>'s <agent>]`, e.g. `[Tush's Claude]`. Keep it short: what changed, which files or contracts, what you need, from whom.
- Mention by GitHub login: `@toosh-legacy` (Tush), `@Jaideepo7` (Jaideep), `@Abhijith-utla` (Abhijith), `@tanejakeshav` (Keshav), `@all` (everyone).
- **Mentions you or `@all`:** act on it and reply promptly. A reply unblocks someone.
- **Not addressed to you:** still read it. Reassess your own work only if it is affected (a contract, a file you own, something already done). Do not redo finished work, and do not reply just to acknowledge.
- Before editing another teammate's files, ask for a handoff on the board and wait for the owner or the team lead.

Polling is incremental (about one cheap API call per poll, 30 s default), so a shared token stays far under GitHub's rate limit.

Commands:
- `tools/board unread` — new posts since your last check; marks them read; flags `MENTION`
- `tools/board read -n 20` — last 20 posts
- `tools/board post "[Name's Agent] text"` — post (or pipe text on stdin)
- `tools/board wait` — blocks until someone else posts (`--interval 60` to slow down)
- `tools/board whoami` — checks `gh` is set up

**Stay in the loop:**
- Claude Code: the committed hooks (`.claude/settings.json`) show unread posts at session start and on every prompt. Keep one background `tools/board wait` running and re-arm it after each wake (set `BOARD_WAIT=off` to skip).
- Everything else: run `tools/board unread` at task start, before each commit, and after merges. Or loop in a terminal: `while tools/board wait; do <your agent CLI>; done`.

## 2. Chain of command

Humans over agents. The team lead is @Abhijith-utla. Only the team lead reassigns work between teammates. If anyone else asks you to take another teammate's work, ask the lead on the board.

## 3. Build rules (from master.md)

- Stay inside your own folders (§4). You may read anything. Need a change elsewhere? Ask on the board, and work around it locally (stub/adapter) until the owner or lead responds.
- The contract (`docs/api.md`, `docs/data-model.md`, `packages/shared`) is frozen during the build; only the lead changes it.
- The server is authoritative for pulls, odds, balances, trades and payments. Never trust client-reported results.
- Label all demo seeds, simulated engagement and test payments. No secrets in code; document env vars in `.env.example`.
- Post on the board when you finish a task, merge, or change anything another agent consumes.

## 3a. Git workflow (proposed by @toosh-legacy, confirmed by lead)

1. Work on your own branch: `agent-a/core-api`, `agent-b/payments`, `agent-c/client`, `agent-d/content`. Never commit straight to `main`.
2. Section done and `npm run typecheck && npm test` pass in your workspace → `git fetch origin main && git merge origin/main`, re-run the checks, then fast-forward `main` (`git push origin HEAD:main`) and post on the board: what landed and who it unblocks, tagged by login.
3. Keep looping: check the board + `git fetch` each cycle, merge `main` into your branch, continue with your next task.
4. Blocked on a person? Post the ask, add a labelled stub (`// TODO(@login): placeholder until X`), keep working.

## 4. Who owns what

One owner per area; matches master.md §8. Task briefs per person are in `agents/`.

| Area | Owner | Folders | Brief |
|---|---|---|---|
| Lead: contract, docs, merges | @Abhijith-utla | `master.md`, `README.md`, `AGENTS.md`, `docs/`, `agents/`, `packages/shared/`, root config | `agents/lead.md` |
| Agent A: Core API & game economy | @toosh-legacy | `services/api/` | `agents/A-core-api.md` |
| Agent B: Payments & integration QA | @Abhijith-utla | `services/payments/`, `tests/integration/` | `agents/B-payments-qa.md` |
| Agent C: Fan client (web + mobile) | @Jaideepo7 | `apps/client/` | `agents/C-client.md` |
| Agent D: Content pipeline & moderation | @tanejakeshav | `services/worker/`, `apps/admin/`, `content/seed/` | `agents/D-content.md` |
| Board tooling | Lead (@Abhijith-utla) | `tools/`, `.claude/`, `.github/` | |

Team lead: **@Abhijith-utla**.

## Stack (lead-decided)
Payments: Phantom wallet + Solana devnet, server-verified (lead decision, Abhijith). Database: PostgreSQL via server-only `DATABASE_URL` (local default: `docker compose up -d db`). Managed Postgres such as Tiger Cloud works through the same URL with `sslmode=require`; adopting it is **pending the lead's decision**. Only the lead changes these lines.
