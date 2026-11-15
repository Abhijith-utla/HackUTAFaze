import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { checkContributionTransfer, type ContributionChain, type ContributionPayout } from "../src/contributions.js";
import { fail } from "../src/errors.js";
import { encodeKey } from "../src/pack-payment.js";
import { makeAdmin, pool, signup } from "./helpers.js";

const recipient = encodeKey(Buffer.alloc(32, 4));
const payer = encodeKey(Buffer.alloc(32, 5));
const reference = encodeKey(Buffer.alloc(32, 6));

function transaction(quote: ContributionPayout) {
  return {
    err: null,
    accountKeys: [
      { pubkey: quote.reference, signer: false },
      { pubkey: quote.payerWallet, signer: true },
      { pubkey: quote.recipient, signer: false },
    ],
    instructions: [{
      programId: "11111111111111111111111111111111",
      parsed: { type: "transfer", info: { source: quote.payerWallet, destination: quote.recipient, lamports: quote.lamports } },
    }],
  };
}

describe("contribution transfer verification (pure)", () => {
  const quote: ContributionPayout = { id: "proposal", reference, recipient, payerWallet: payer, lamports: 50_000_000, cluster: "devnet" };

  it("requires a successful exact System Program transfer signed by the quoted payer and carrying the reference", () => {
    const base = transaction(quote);
    expect(checkContributionTransfer(base, quote)).toEqual({ ok: true });

    const invalid = [
      (t: any) => { t.err = { InstructionError: [0, "Custom"] }; },
      (t: any) => { t.accountKeys.shift(); },
      (t: any) => { t.accountKeys[1].signer = false; },
      (t: any) => { t.instructions[0].parsed.info.source = recipient; },
      (t: any) => { t.instructions[0].parsed.info.destination = payer; },
      (t: any) => { t.instructions[0].parsed.info.lamports = quote.lamports - 1; },
      (t: any) => { t.instructions[0].parsed.info.lamports = quote.lamports + 1; },
    ];
    for (const mutate of invalid) {
      const candidate = structuredClone(base);
      mutate(candidate);
      expect(checkContributionTransfer(candidate, quote)).toMatchObject({ ok: false });
    }
  });
});

let app: FastifyInstance;
let admin: { id: string; cookie: string };
let current: ReturnType<typeof transaction>;

const chain: ContributionChain = {
  async verify(quote) {
    const result = checkContributionTransfer(current, quote);
    if (!result.ok) fail("VALIDATION", result.reason);
  },
};

const as = (cookie: string) => ({ headers: { cookie } });

async function submit(app: FastifyInstance, cookie: string, title = "The viral trickshot return") {
  const r = await app.inject({
    method: "POST",
    url: "/contributions",
    ...as(cookie),
    payload: {
      title,
      pitch: "A community-pitched, rights-safe card idea for a viral FaZe moment.",
      fazeMember: "FaZe Temperrr",
      sourceUrl: "https://example.com/clip",
      recipientWallet: recipient,
    },
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().contribution;
}

beforeAll(async () => {
  app = await buildApp({ contributionChain: chain });
  await app.ready();
  admin = await makeAdmin();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("Open Contributions API", () => {
  it("keeps staff review routes admin-only", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/contributions" })).statusCode).toBe(401);
    const fan = await signup(app);
    expect((await app.inject({ method: "GET", url: "/admin/contributions", ...as(fan.cookie) })).statusCode).toBe(403);
  });

  it("moves a contribution through review, a single quoted payout, and a verified receipt", async () => {
    const fan = await signup(app, "Contributor");
    const proposal = await submit(app, fan.cookie);

    const pending = await app.inject({ method: "GET", url: "/admin/contributions?status=pending", ...as(admin.cookie) });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().contributions.map((p: { id: string }) => p.id)).toContain(proposal.id);

    const approved = await app.inject({ method: "POST", url: `/admin/contributions/${proposal.id}/approve`, ...as(admin.cookie), payload: { bountyLamports: 50_000_000, note: "Strong source and a clear collector angle." } });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().contribution.status).toBe("approved");

    const quote = await app.inject({ method: "POST", url: `/admin/contributions/${proposal.id}/payouts`, ...as(admin.cookie), payload: { payerWallet: payer } });
    expect(quote.statusCode, quote.body).toBe(201);
    expect(quote.json().payout).toMatchObject({ recipient, payerWallet: payer, lamports: 50_000_000, cluster: "devnet" });
    const again = await app.inject({ method: "POST", url: `/admin/contributions/${proposal.id}/payouts`, ...as(admin.cookie), payload: { payerWallet: payer } });
    expect(again.statusCode).toBe(200);
    expect(again.json().payout.reference).toBe(quote.json().payout.reference);

    current = transaction(quote.json().payout);
    const paid = await app.inject({ method: "POST", url: `/admin/contributions/${proposal.id}/payouts/confirm`, ...as(admin.cookie), payload: { signature: "contribution-payment-one" } });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().contribution.status).toBe("paid");
    expect((await app.inject({ method: "POST", url: `/admin/contributions/${proposal.id}/payouts`, ...as(admin.cookie), payload: { payerWallet: payer } })).statusCode).toBe(409);
  });

  it("never exposes a payout for rejected work and refuses a reused transaction signature", async () => {
    const fan = await signup(app);
    const rejected = await submit(app, fan.cookie, "The rejected clip");
    const no = await app.inject({ method: "POST", url: `/admin/contributions/${rejected.id}/reject`, ...as(admin.cookie), payload: { note: "Insufficient rights and source evidence." } });
    expect(no.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/admin/contributions/${rejected.id}/payouts`, ...as(admin.cookie), payload: { payerWallet: payer } })).statusCode).toBe(409);

    const retry = await submit(app, fan.cookie, "The second accepted clip");
    await app.inject({ method: "POST", url: `/admin/contributions/${retry.id}/approve`, ...as(admin.cookie), payload: { bountyLamports: 50_000_000 } });
    const quote = await app.inject({ method: "POST", url: `/admin/contributions/${retry.id}/payouts`, ...as(admin.cookie), payload: { payerWallet: payer } });
    current = transaction(quote.json().payout);
    const replay = await app.inject({ method: "POST", url: `/admin/contributions/${retry.id}/payouts/confirm`, ...as(admin.cookie), payload: { signature: "contribution-payment-one" } });
    expect(replay.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/admin/contributions?status=payout_pending", ...as(admin.cookie) })).json().contributions.map((p: { id: string }) => p.id).toContain(retry.id));
  });
});
