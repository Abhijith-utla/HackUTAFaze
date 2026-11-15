import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { WalletError, connectPhantom, requirePhantom, signAndSendDevnet } from "./wallet";

export type ContributionQuote = {
  id: string;
  reference: string;
  recipient: string;
  payerWallet: string;
  lamports: number;
  cluster: string;
};

/** Guards a server-issued quote before the browser constructs a wallet transaction. */
export function validateContributionQuote(quote: ContributionQuote, wallet: string) {
  if (quote.cluster !== "devnet") throw Error("Contribution rewards are available on Solana Devnet only.");
  if (quote.payerWallet !== wallet) throw Error("Connect the quoted payer wallet before sending this reward.");
  if (!Number.isSafeInteger(quote.lamports) || quote.lamports <= 0) throw Error("The quoted reward amount is invalid.");
}

export async function connectContributionWallet(): Promise<string> {
  return (await connectPhantom()).toBase58();
}

export const connectContributionPayer = connectContributionWallet;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const savedKey = (quoteId: string) => `faze.payout.${quoteId}`;
const readSaved = (quoteId: string): string | null => { try { return localStorage.getItem(savedKey(quoteId)); } catch { return null; } };
const writeSaved = (quoteId: string, signature: string) => { try { localStorage.setItem(savedKey(quoteId), signature); } catch { /* a missing hint only costs one chain lookup */ } };

/** Polls until the devnet transfer is finalized (the server only credits finalized transfers). Throws if it failed on-chain. */
async function waitForFinalized(connection: Connection, signature: string, onStatus: (message: string) => void) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw Error("The reward transfer failed on-chain. Nothing was paid; start the payout again.");
    if (status?.confirmationStatus === "finalized") return;
    onStatus(`Reward sent. Waiting for Solana devnet to finalize it (${status?.confirmationStatus ?? "not yet seen"})…`);
    await sleep(2_000);
  }
  throw Error("Still finalizing on devnet. The reward was sent. Press Finish payout again in a minute; it will only verify, never pay twice.");
}

/**
 * Pays (at most once) and returns a FINALIZED signature for the server-issued devnet transfer.
 * Idempotent per quote: if this quote was already paid (signature saved locally, or found on-chain by its reference),
 * it skips sending and only waits for finalization, so "Finish payout" can never double-pay.
 * Server confirmation remains authoritative.
 */
export async function signContributionPayout(quote: ContributionQuote, onStatus: (message: string) => void): Promise<string> {
  const phantom = requirePhantom();
  const publicKey = await connectPhantom();
  validateContributionQuote(quote, publicKey.toBase58());
  const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");

  let signature = readSaved(quote.id);
  if (!signature) {
    onStatus("Checking devnet for an earlier payment on this quote…");
    const found = await connection.getSignaturesForAddress(new PublicKey(quote.reference), { limit: 10 }).catch(() => []);
    signature = found.find((row) => !row.err)?.signature ?? null;
    if (signature) writeSaved(quote.id, signature);
  }

  if (!signature) {
    const transfer = SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(quote.recipient), lamports: quote.lamports });
    transfer.keys.push({ pubkey: new PublicKey(quote.reference), isSigner: false, isWritable: false });
    const transaction = new Transaction().add(transfer);
    transaction.feePayer = publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const fee = (await connection.getFeeForMessage(transaction.compileMessage(), "confirmed")).value;
    if (fee === null) throw Error("Could not estimate the devnet network fee. Try again before sending.");
    if (await connection.getBalance(publicKey, "confirmed") < quote.lamports + fee) throw Error("Not enough devnet SOL for this reward and its network fee.");

    onStatus("Approve the exact devnet reward in Phantom.");
    try {
      signature = await signAndSendDevnet(phantom, connection, transaction);
      writeSaved(quote.id, signature);
    } catch (error) {
      if ((error as WalletError).code === 4001) throw Error("Reward cancelled in Phantom. Nothing was paid; you can retry this quote.");
      throw Error((error as Error).message);
    }
  }

  await waitForFinalized(connection, signature, onStatus);
  return signature;
}
