import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { SignJWT } from "jose";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { memoryLedger } from "../src/ledger.js";
import { memoryRepo } from "../src/repo.js";
import { checkTransfer, simulatedReader, solanaPayUrl, type ChainReader, type ChainTx } from "../src/solana.js";

const JWT_SECRET = "test-jwt-secret";
const TREASURY = Keypair.generate().publicKey.toBase58();
const PAYER = Keypair.generate().publicKey.toBase58();
const sig = () => Keypair.generate().publicKey.toBase58() + "x".repeat(20); // base58, sig-length

async function token(sub: string) {
  return new SignJWT({ role: "fan" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** In-memory "chain": tests put transactions in it. */
function fakeChain(): ChainReader & { txs: Map<string, ChainTx>; byRef: Map<string, string> } {
  const txs = new Map<string, ChainTx>();
  const byRef = new Map<string, string>();
  return {
    cluster: "devnet",
    txs,
    byRef,
    async getTx(s) {
      return txs.get(s) ?? null;
    },
    async findSignature(ref) {
      return byRef.get(ref);
    },
  };
}

function transfer(reference: string, lamports: number, opts: { to?: string; err?: unknown } = {}): ChainTx {
  return {
    err: opts.err ?? null,
    accountKeys: [PAYER, opts.to ?? TREASURY, "11111111111111111111111111111111", reference],
    preBalances: [1_000_000_000, 5, 1, 0],
    postBalances: [1_000_000_000 - lamports - 5000, 5 + lamports, 1, 0],
  };
}

function setup() {
  const repo = memoryRepo();
  const ledger = memoryLedger();
  const chain = fakeChain();
  const app = buildApp({ repo, ledger, chain, treasury: TREASURY, jwtSecret: JWT_SECRET, clientUrl: "http://localhost:3000" });
  return { app, repo, ledger, chain };
}

describe("payments (Solana devnet)", () => {
  let t: ReturnType<typeof setup>;
  const userId = randomUUID();
  beforeEach(() => {
    t = setup();
  });

  async function checkout(bundleId = "coins_1000", uid = userId) {
    return t.app.inject({ method: "POST", url: "/payments/checkout", cookies: { session: await token(uid) }, payload: { bundleId } });
  }
  async function confirm(payload: Record<string, unknown>, uid = userId) {
    return t.app.inject({ method: "POST", url: "/payments/confirm", cookies: { session: await token(uid) }, payload });
  }

  it("lists devnet bundles with the treasury", async () => {
    const res = await t.app.inject({ method: "GET", url: "/payments/bundles" });
    expect(res.json()).toMatchObject({ cluster: "devnet", recipient: TREASURY, testMode: true });
  });

  it("checkout requires a valid session", async () => {
    const res = await t.app.inject({ method: "POST", url: "/payments/checkout", payload: { bundleId: "coins_1000" } });
    expect(res.statusCode).toBe(401);
    const forged = await new SignJWT({ role: "fan" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("1h").sign(new TextEncoder().encode("nope"));
    const res2 = await t.app.inject({ method: "POST", url: "/payments/checkout", cookies: { session: forged }, payload: { bundleId: "coins_1000" } });
    expect(res2.statusCode).toBe(401);
  });

  it("rejects unknown bundles", async () => {
    const res = await checkout("coins_free");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("checkout returns a unique reference and a Solana Pay URL", async () => {
    const a = (await checkout()).json();
    const b = (await checkout()).json();
    expect(a.reference).not.toBe(b.reference);
    expect(a).toMatchObject({ recipient: TREASURY, lamports: 50_000_000, cluster: "devnet" });
    expect(a.solanaPayUrl).toBe(solanaPayUrl(TREASURY, 50_000_000, a.reference, "devnet"));
    expect(a.solanaPayUrl).toContain("amount=0.05");
  });

  it("credits once after an on-chain transfer, and repeat confirms do not double-credit", async () => {
    const c = (await checkout()).json();
    const s = sig();
    t.chain.txs.set(s, transfer(c.reference, c.lamports));

    const first = await confirm({ purchaseId: c.purchaseId, signature: s });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "paid", credited: 1000, balance: 1000 });

    const again = await confirm({ purchaseId: c.purchaseId, signature: s });
    expect(again.json()).toMatchObject({ status: "paid", credited: 0, balance: 1000 });
    expect(t.ledger.balances.get(userId)).toBe(1000);
  });

  it("concurrent confirms credit once", async () => {
    const c = (await checkout()).json();
    const s = sig();
    t.chain.txs.set(s, transfer(c.reference, c.lamports));
    await Promise.all([confirm({ purchaseId: c.purchaseId, signature: s }), confirm({ purchaseId: c.purchaseId, signature: s })]);
    expect(t.ledger.balances.get(userId)).toBe(1000);
  });

  it("finds the signature by reference when the client omits it", async () => {
    const c = (await checkout()).json();
    const s = sig();
    t.chain.txs.set(s, transfer(c.reference, c.lamports));
    t.chain.byRef.set(c.reference, s);
    const res = await confirm({ purchaseId: c.purchaseId });
    expect(res.json().credited).toBe(1000);
  });

  it("409 while the tx is not on-chain yet", async () => {
    const c = (await checkout()).json();
    expect((await confirm({ purchaseId: c.purchaseId })).statusCode).toBe(409);
    expect((await confirm({ purchaseId: c.purchaseId, signature: sig() })).statusCode).toBe(409);
    expect(t.ledger.balances.size).toBe(0);
  });

  it("rejects underpayment, wrong recipient, missing reference and failed txs", async () => {
    const c = (await checkout()).json();
    const cases: ChainTx[] = [
      transfer(c.reference, c.lamports - 1),
      transfer(c.reference, c.lamports, { to: Keypair.generate().publicKey.toBase58() }),
      transfer(Keypair.generate().publicKey.toBase58(), c.lamports),
      transfer(c.reference, c.lamports, { err: { InstructionError: [0, "Custom"] } }),
    ];
    for (const tx of cases) {
      const s = sig();
      t.chain.txs.set(s, tx);
      const res = await confirm({ purchaseId: c.purchaseId, signature: s });
      expect(res.statusCode).toBe(400);
    }
    expect(t.ledger.balances.size).toBe(0);
  });

  it("one transaction cannot pay for two purchases", async () => {
    const a = (await checkout()).json();
    const b = (await checkout()).json();
    const s = sig();
    t.chain.txs.set(s, transfer(a.reference, a.lamports));
    expect((await confirm({ purchaseId: a.purchaseId, signature: s })).statusCode).toBe(200);
    const res = await confirm({ purchaseId: b.purchaseId, signature: s });
    expect(res.statusCode).toBe(400);
    expect(t.ledger.balances.get(userId)).toBe(1000);
  });

  it("cannot confirm someone else's purchase", async () => {
    const c = (await checkout()).json();
    const res = await confirm({ purchaseId: c.purchaseId, signature: sig() }, randomUUID());
    expect(res.statusCode).toBe(404);
  });

  it("rejects malformed input", async () => {
    expect((await confirm({ purchaseId: "nope" })).statusCode).toBe(400);
    const c = (await checkout()).json();
    expect((await confirm({ purchaseId: c.purchaseId, signature: "0OIl" + "!".repeat(40) })).statusCode).toBe(400);
  });

  it("ledger outage → 409 and stays pending, then succeeds on retry", async () => {
    const real = t.ledger.credit.bind(t.ledger);
    let down = true;
    t.ledger.credit = async (b) => {
      if (down) throw new Error("api down");
      return real(b);
    };
    const c = (await checkout()).json();
    const s = sig();
    t.chain.txs.set(s, transfer(c.reference, c.lamports));
    expect((await confirm({ purchaseId: c.purchaseId, signature: s })).statusCode).toBe(409);
    expect(t.repo.rows[0]!.status).toBe("pending");
    down = false;
    expect((await confirm({ purchaseId: c.purchaseId, signature: s })).json().credited).toBe(1000);
  });

  it("lists only the caller's purchases", async () => {
    await checkout();
    await checkout("coins_2500", randomUUID());
    const res = await t.app.inject({ method: "GET", url: "/me/purchases", cookies: { session: await token(userId) } });
    expect(res.json().purchases).toHaveLength(1);
    expect(res.json().purchases[0]).toMatchObject({ testMode: true, cluster: "devnet", status: "pending" });
  });
});

describe("simulated signatures through the app", () => {
  it("are accepted by validation and credited (PAYMENTS_SIMULATE path)", async () => {
    const repo = memoryRepo();
    const ledger = memoryLedger();
    const app = buildApp({ repo, ledger, chain: simulatedReader(TREASURY, "devnet"), treasury: TREASURY, jwtSecret: JWT_SECRET, clientUrl: "http://localhost:3000" });
    const uid = randomUUID();
    const cookies = { session: await token(uid) };
    const c = (await app.inject({ method: "POST", url: "/payments/checkout", cookies, payload: { bundleId: "coins_1000" } })).json();
    const res = await app.inject({ method: "POST", url: "/payments/confirm", cookies, payload: { purchaseId: c.purchaseId, signature: `sim_${c.reference}_${c.lamports}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().credited).toBe(1000);
  });

  it("RPC errors become a retryable 409, not a 500", async () => {
    const t = setup();
    t.chain.getTx = async () => {
      throw new Error("429 too many requests");
    };
    const uid = randomUUID();
    const cookies = { session: await token(uid) };
    const c = (await t.app.inject({ method: "POST", url: "/payments/checkout", cookies, payload: { bundleId: "coins_1000" } })).json();
    const res = await t.app.inject({ method: "POST", url: "/payments/confirm", cookies, payload: { purchaseId: c.purchaseId, signature: sig() } });
    expect(res.statusCode).toBe(409);
  });
});

describe("checkTransfer", () => {
  it("accepts an exact payment", () => {
    const ref = Keypair.generate().publicKey.toBase58();
    expect(checkTransfer(transfer(ref, 10), { reference: ref, recipient: TREASURY, lamports: 10 })).toEqual({ ok: true });
  });
});

describe("simulatedReader", () => {
  it("only understands sim_<reference>_<lamports>", async () => {
    const r = simulatedReader(TREASURY, "devnet");
    const ref = Keypair.generate().publicKey.toBase58();
    const tx = await r.getTx(`sim_${ref}_50000000`);
    expect(tx && checkTransfer(tx, { reference: ref, recipient: TREASURY, lamports: 50_000_000 })).toEqual({ ok: true });
    expect(await r.getTx(sig())).toBeNull();
  });
});

describe("config", () => {
  const base = { DATABASE_URL: "postgres://x", JWT_SECRET: "j", INTERNAL_SECRET: "i", SOLANA_TREASURY_PUBKEY: TREASURY };
  it("defaults to devnet", () => {
    expect(loadConfig(base)).toMatchObject({ cluster: "devnet", rpcUrl: "https://api.devnet.solana.com" });
  });
  it("refuses mainnet", () => {
    expect(() => loadConfig({ ...base, SOLANA_CLUSTER: "mainnet-beta" })).toThrow(/never mainnet/);
    expect(() => loadConfig({ ...base, SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" })).toThrow(/mainnet/);
  });
  it("refuses an invalid treasury and simulate in production", () => {
    expect(() => loadConfig({ ...base, SOLANA_TREASURY_PUBKEY: "nope" })).toThrow(/valid Solana/);
    expect(() => loadConfig({ ...base, PAYMENTS_SIMULATE: "1", NODE_ENV: "production" })).toThrow(/test-only/);
  });
});
