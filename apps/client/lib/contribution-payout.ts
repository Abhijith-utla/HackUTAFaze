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

/** Opens Phantom for exactly the server-issued devnet transfer. Server confirmation remains authoritative. */
export async function signContributionPayout(quote: ContributionQuote, onStatus: (message: string) => void): Promise<string> {
  const phantom = requirePhantom();
  const publicKey = await connectPhantom();
  validateContributionQuote(quote, publicKey.toBase58());

  const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
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
    return await signAndSendDevnet(phantom, connection, transaction);
  } catch (error) {
    if ((error as WalletError).code === 4001) throw Error("Reward cancelled in Phantom. Nothing was paid; you can retry this quote.");
    throw Error((error as Error).message);
  }
}
