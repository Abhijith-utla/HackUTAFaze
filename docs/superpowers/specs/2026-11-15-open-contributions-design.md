# Open Contributions design

## Intent

Replace the sprawling Control Room dashboard with two decisive staff surfaces:

1. **Analytics** — the health of the collector economy and live drops.
2. **Open Contributions** — a card-entry form plus the queue of community-pitched viral moments and card concepts.

An administrator should be able to review one contribution in seconds, approve or reject it with a reason, and reward accepted work with a clearly labelled **Solana devnet** payout.

## Product decisions

- `/admin/control` defaults to Analytics. The primary shell exposes only Analytics and Open Contributions; the existing specialist pages remain deep-linkable but no longer compete in the main navigation.
- Open Contributions has two modes: **Add card** uses the existing server-authoritative card API; **Community queue** renders submitted proposals with evidence, recipient wallet, proposed bounty, and an explicit approve/reject decision.
- Approving a contribution changes it to `approved` and unlocks, but does not silently perform, a payout. The administrator must connect Phantom and explicitly sign one devnet transfer from the payer wallet to the contributor’s displayed public wallet.
- FaZe verifies the submitted signature on devnet, including payer, recipient, amount and a unique transfer reference, before marking the contribution `paid`. The server never has a wallet private key.
- Every proposed card, decision and payout appears in the append-only audit log. All seeded proposals and payouts are marked `demo`.

## Constraints

- Devnet only. Mainnet RPC URLs and real-value payments remain rejected by the existing application rules.
- The legacy BlinkBounties README advertises escrow bounty instructions, but its current Anchor source implements a raffle (`create_raffle`, `buy_tickets`, `claim_proceeds`) rather than those escrow instructions. It is not integrated as a payout contract.
- Existing pack payments, fan sign-in, content operations and specialist Control Room routes retain their current contracts during this change.
- A contribution can be paid at most once; duplicate signature, already-paid contribution, wrong recipient, wrong payer, wrong amount, or missing reference are rejected.

## Architecture

`contribution_proposals` records the community pitch, recipient public key, proposed devnet bounty, review state and one payout reference/signature. Admin routes create, list, approve, reject, quote and confirm payouts. A small pure transaction verifier is tested independently and uses the same Solana System Program transfer/referrer pattern as direct pack checkout.

The client calls the existing admin card endpoints for directly added cards. For approved community pitches, it obtains a server-issued payout quote, uses Phantom to sign the transfer, and asks the server to confirm before the UI renders it as paid.

## Approaches considered

1. **New Anchor escrow program:** most contract-faithful, but requires a correct escrow program, deployment, wallet integration and security review. Not safe to imply from the stale BlinkBounties README.
2. **Admin-signed devnet transfer with server verification:** preserves wallet custody, matches existing FaZe payment mechanics and supports an end-to-end demo now. **Chosen.**
3. **Visual-only review queue:** fastest, but fails the requested contributor reward flow.

## Non-goals

- Mainnet payout, fiat value, unattended payouts or a server-held private key.
- Migrating or deleting existing campaigns, archive intelligence, card/packs or moderation data.
- Treating the BlinkBounties raffle program as an escrow bounty contract.

## Acceptance

- The main admin navigation shows only two tabs: Analytics and Open Contributions.
- An admin can add a card using existing sets and card validation.
- The queue lists pending proposals, and approve/reject decisions persist and audit.
- An approved proposal can receive one devnet payout after an admin signs in Phantom; server verification updates it to paid.
- Invalid, duplicate or replayed payout confirmation cannot mark a contribution paid.
