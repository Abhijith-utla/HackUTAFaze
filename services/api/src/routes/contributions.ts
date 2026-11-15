import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "../auth.js";
import { type ContributionChain, type ContributionPayout, isSolanaPublicKey, liveContributionChain, newContributionReference } from "../contributions.js";
import { pool, tx, type Db } from "../db.js";
import { fail } from "../errors.js";

const Id = z.object({ id: z.string().uuid() });
const Status = z.enum(["pending", "approved", "rejected", "payout_pending", "paid"]);
const ProposalBody = z.object({
  title: z.string().trim().min(3).max(100),
  pitch: z.string().trim().min(10).max(2000),
  fazeMember: z.string().trim().min(2).max(80),
  sourceUrl: z.string().url().max(2000).optional().default(""),
  recipientWallet: z.string().trim().refine(isSolanaPublicKey, "recipientWallet must be a Solana public key"),
});
const ReviewBody = z.object({ bountyLamports: z.number().int().min(1).max(1_000_000_000), note: z.string().trim().max(1000).optional().default("") });
const RejectBody = z.object({ note: z.string().trim().min(3).max(1000) });
const PayerBody = z.object({ payerWallet: z.string().trim().refine(isSolanaPublicKey, "payerWallet must be a Solana public key") });
const SignatureBody = z.object({ signature: z.string().trim().min(1).max(128) });

function toContribution(row: any) {
  return {
    id: row.id,
    title: row.title,
    pitch: row.pitch,
    fazeMember: row.faze_member,
    sourceUrl: row.source_url,
    recipientWallet: row.recipient_wallet,
    contributorName: row.contributor_name,
    bountyLamports: Number(row.bounty_lamports),
    status: row.status,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    demo: row.demo,
    payout: row.payout_reference ? {
      reference: row.payout_reference,
      payerWallet: row.payout_payer_wallet,
      signature: row.payout_signature,
      cluster: row.payout_cluster,
    } : null,
  };
}

function payoutFor(row: any): ContributionPayout {
  if (!row.payout_reference || !row.payout_payer_wallet || !row.bounty_lamports) fail("CONFLICT", "Payout quote is incomplete");
  return {
    id: row.id,
    reference: row.payout_reference,
    recipient: row.recipient_wallet,
    payerWallet: row.payout_payer_wallet,
    lamports: Number(row.bounty_lamports),
    cluster: "devnet",
  };
}

async function audit(db: Db, actor: string | null, action: string, contributionId: string, detail: object = {}) {
  await db.query("INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1,$2,'contribution',$3,$4)", [actor, action, contributionId, JSON.stringify(detail)]);
}

async function locked(db: Db, id: string) {
  const result = await db.query("SELECT * FROM contribution_proposals WHERE id=$1 FOR UPDATE", [id]);
  if (!result.rowCount) fail("NOT_FOUND", "Contribution not found");
  return result.rows[0];
}

export async function contributionRoutes(app: FastifyInstance, chain: ContributionChain = liveContributionChain) {
  app.post("/contributions", async (req, reply) => {
    const user = requireUser(req);
    const body = ProposalBody.parse(req.body);
    const account = await pool.query("SELECT display_name FROM users WHERE id=$1", [user.sub]);
    if (!account.rowCount) fail("UNAUTHENTICATED", "Account no longer exists");
    const result = await pool.query(
      "INSERT INTO contribution_proposals (creator_user_id,contributor_name,title,pitch,faze_member,source_url,recipient_wallet,demo) VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING *",
      [user.sub, account.rows[0].display_name, body.title, body.pitch, body.fazeMember, body.sourceUrl, body.recipientWallet],
    );
    await audit(pool, user.sub, "contribution.submit", result.rows[0].id, { title: body.title });
    return reply.code(201).send({ contribution: toContribution(result.rows[0]) });
  });

  app.get("/admin/contributions", async (req) => {
    requireAdmin(req);
    const query = z.object({ status: Status.optional() }).parse(req.query ?? {});
    const result = query.status
      ? await pool.query("SELECT * FROM contribution_proposals WHERE status=$1 ORDER BY created_at ASC", [query.status])
      : await pool.query("SELECT * FROM contribution_proposals ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'payout_pending' THEN 2 ELSE 3 END, created_at ASC");
    return { contributions: result.rows.map(toContribution) };
  });

  app.post("/admin/contributions/:id/approve", async (req) => {
    const admin = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const body = ReviewBody.parse(req.body);
    const contribution = await tx(async (db) => {
      const row = await locked(db, id);
      if (row.status !== "pending") fail("CONFLICT", `Contribution is already ${row.status}`);
      const updated = await db.query("UPDATE contribution_proposals SET status='approved', bounty_lamports=$2, review_note=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 RETURNING *", [id, body.bountyLamports, body.note, admin.sub]);
      await audit(db, admin.sub, "contribution.approve", id, { bountyLamports: body.bountyLamports });
      return updated.rows[0];
    });
    return { contribution: toContribution(contribution) };
  });

  app.post("/admin/contributions/:id/reject", async (req) => {
    const admin = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const body = RejectBody.parse(req.body);
    const contribution = await tx(async (db) => {
      const row = await locked(db, id);
      if (row.status !== "pending") fail("CONFLICT", `Contribution is already ${row.status}`);
      const updated = await db.query("UPDATE contribution_proposals SET status='rejected', review_note=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1 RETURNING *", [id, body.note, admin.sub]);
      await audit(db, admin.sub, "contribution.reject", id);
      return updated.rows[0];
    });
    return { contribution: toContribution(contribution) };
  });

  app.post("/admin/contributions/:id/payouts", async (req, reply) => {
    const admin = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const body = PayerBody.parse(req.body);
    const result = await tx(async (db) => {
      const row = await locked(db, id);
      if (row.status === "paid" || row.status === "rejected" || row.status === "pending") fail("CONFLICT", "Contribution is not ready for a payout");
      if (row.status === "payout_pending") {
        if (row.payout_payer_wallet !== body.payerWallet) fail("CONFLICT", "This payout quote belongs to another payer wallet");
        return { quote: payoutFor(row), created: false };
      }
      const updated = await db.query("UPDATE contribution_proposals SET status='payout_pending', payout_reference=$2, payout_payer_wallet=$3, payout_cluster='devnet' WHERE id=$1 RETURNING *", [id, newContributionReference(), body.payerWallet]);
      await audit(db, admin.sub, "contribution.payout_quote", id, { payerWallet: body.payerWallet, bountyLamports: Number(row.bounty_lamports), cluster: "devnet" });
      return { quote: payoutFor(updated.rows[0]), created: true };
    });
    return reply.code(result.created ? 201 : 200).send({ payout: result.quote });
  });

  app.post("/admin/contributions/:id/payouts/confirm", async (req) => {
    const admin = requireAdmin(req);
    const { id } = Id.parse(req.params);
    const body = SignatureBody.parse(req.body);
    const before = await pool.query("SELECT * FROM contribution_proposals WHERE id=$1", [id]);
    if (!before.rowCount) fail("NOT_FOUND", "Contribution not found");
    const current = before.rows[0];
    if (current.status === "paid") {
      if (current.payout_signature === body.signature) return { contribution: toContribution(current) };
      fail("CONFLICT", "Contribution already has a verified payout");
    }
    if (current.status !== "payout_pending") fail("CONFLICT", "Contribution has no pending payout");
    await chain.verify(payoutFor(current), body.signature);
    try {
      const contribution = await tx(async (db) => {
        const row = await locked(db, id);
        if (row.status === "paid") {
          if (row.payout_signature === body.signature) return row;
          fail("CONFLICT", "Contribution already has a verified payout");
        }
        if (row.status !== "payout_pending") fail("CONFLICT", "Contribution payout state changed; do not pay again");
        const reused = await db.query("SELECT id FROM contribution_proposals WHERE payout_signature=$1 AND id<>$2", [body.signature, id]);
        if (reused.rowCount) fail("VALIDATION", "Transaction signature was already used for another contribution");
        const updated = await db.query("UPDATE contribution_proposals SET status='paid', payout_signature=$2, paid_at=now() WHERE id=$1 RETURNING *", [id, body.signature]);
        await audit(db, admin.sub, "contribution.payout_confirm", id, { signature: body.signature, cluster: "devnet" });
        return updated.rows[0];
      });
      return { contribution: toContribution(contribution) };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") fail("VALIDATION", "Transaction signature was already used for another contribution");
      throw error;
    }
  });
}
