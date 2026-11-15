import { randomBytes } from "node:crypto";
import { fail } from "./errors.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type ContributionPayout = {
  id: string;
  reference: string;
  recipient: string;
  payerWallet: string;
  lamports: number;
  cluster: "devnet";
};

export type ParsedContributionTransaction = {
  err: unknown | null;
  accountKeys: { pubkey: string; signer: boolean }[];
  instructions: { programId: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number | string } } }[];
};

export type ContributionCheck = { ok: true } | { ok: false; reason: string };

/** A pure, strict receipt check. It deliberately accepts no balance-delta approximation. */
export function checkContributionTransfer(tx: ParsedContributionTransaction, quote: ContributionPayout): ContributionCheck {
  if (tx.err) return { ok: false, reason: "transaction failed on-chain" };
  if (!tx.accountKeys.some((key) => key.pubkey === quote.reference)) return { ok: false, reason: "payout reference is missing" };
  if (!tx.accountKeys.some((key) => key.pubkey === quote.payerWallet && key.signer)) return { ok: false, reason: "quoted payer did not sign" };
  const payment = tx.instructions.some((instruction) =>
    instruction.programId === SYSTEM_PROGRAM
    && instruction.parsed?.type === "transfer"
    && instruction.parsed.info?.source === quote.payerWallet
    && instruction.parsed.info?.destination === quote.recipient
    && BigInt(instruction.parsed.info?.lamports ?? -1) === BigInt(quote.lamports),
  );
  return payment ? { ok: true } : { ok: false, reason: "transaction does not contain the quoted devnet SOL transfer" };
}

export interface ContributionChain {
  verify(quote: ContributionPayout, signature: string): Promise<void>;
}

export function isSolanaPublicKey(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let n = 0n;
  for (const char of value) n = n * 58n + BigInt(BASE58.indexOf(char));
  const bytes = n === 0n ? 0 : Math.ceil(n.toString(16).length / 2);
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}

export function newContributionReference(): string {
  let n = BigInt(`0x${randomBytes(32).toString("hex")}`);
  let output = "";
  while (n) {
    output = BASE58[Number(n % 58n)] + output;
    n /= 58n;
  }
  return output || "1";
}

function settings() {
  const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
  const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  if (cluster !== "devnet" || /mainnet/i.test(rpc)) fail("VALIDATION", "Contribution payouts require Solana devnet");
  return { rpc, cluster: "devnet" as const };
}

async function rpc(url: string, method: string, params: unknown[]) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Error("RPC failed");
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error) throw Error("RPC error");
    return payload.result;
  } catch {
    fail("CONFLICT", "Solana RPC unavailable. Check this payout again; do not pay twice.");
  }
}

export const liveContributionChain: ContributionChain = {
  async verify(quote, signature) {
    const config = settings();
    const genesis = await rpc(config.rpc, "getGenesisHash", []);
    if (genesis !== DEVNET_GENESIS_HASH) fail("VALIDATION", "Configured RPC is not Solana devnet");
    const raw = await rpc(config.rpc, "getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]) as any;
    if (!raw) fail("CONFLICT", "Awaiting finalized payout. Check again shortly.");
    const message = raw.transaction?.message;
    if (!raw.meta || !message) fail("VALIDATION", "Transaction is not a parsed Solana receipt");
    const checked = checkContributionTransfer({
      err: raw.meta.err,
      accountKeys: (message.accountKeys ?? []).map((key: any) => ({ pubkey: key.pubkey, signer: Boolean(key.signer) })),
      instructions: message.instructions ?? [],
    }, quote);
    if (!checked.ok) fail("VALIDATION", checked.reason);
  },
};
