import type { Connection, PublicKey, Transaction } from '@solana/web3.js';

// Shared Phantom helpers for pack checkout and contribution rewards.
// - Finds Phantom on either injection point (window.phantom.solana or window.solana).
// - Maps Phantom's numeric errors to messages a person can act on (4001 declined, 4100 not authorised, 4900/4901 disconnected).
// - Signs in the wallet but broadcasts through OUR devnet RPC, so it works even when Phantom itself is set to mainnet.
//   Server-side verification of the transfer stays authoritative either way.

export type PhantomProvider = {
  isPhantom?: boolean;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  signTransaction?(tx: Transaction): Promise<Transaction>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
};

export class WalletError extends Error {
  code?: number;
  /** True when the transaction may have been broadcast: never offer a blind resend. */
  uncertain = false;
  constructor(message: string, code?: number) { super(message); this.name = 'WalletError'; this.code = code; }
}

export function findPhantom(): PhantomProvider | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w.solana?.isPhantom) return w.solana;
  return undefined;
}

export function requirePhantom(): PhantomProvider {
  const phantom = findPhantom();
  if (!phantom) throw new WalletError('Phantom not found. Install the Phantom extension, unlock it, then reload this page.');
  return phantom;
}

const codeOf = (e: unknown) => (e as { code?: number; error?: { code?: number } })?.code ?? (e as { error?: { code?: number } })?.error?.code;
const textOf = (e: unknown) => String((e as { message?: string })?.message ?? e ?? '');

/** Turns a raw Phantom/RPC failure into a WalletError whose message says what to do next. */
export function explainWalletError(e: unknown, action: 'connect' | 'sign'): WalletError {
  if (e instanceof WalletError) return e;
  const code = codeOf(e), text = textOf(e);
  if (code === 4001 || /user rejected|rejected the request|declined/i.test(text)) {
    return new WalletError(action === 'connect' ? 'You declined the connection in Phantom. Approve it to continue.' : 'You cancelled the payment in Phantom. Nothing was sent.', 4001);
  }
  if (code === 4100 || /not been authori[sz]ed|unauthori[sz]ed/i.test(text)) {
    return new WalletError('Phantom has not authorised this site yet. Open Phantom, unlock it, press Connect for this site (or remove it from Connected Apps and connect again), then retry. Nothing was sent.', 4100);
  }
  if (code === 4900 || code === 4901 || /disconnected/i.test(text)) {
    return new WalletError('Phantom is disconnected. Unlock it, reconnect, then retry.', code);
  }
  if (/403|forbidden|access denied/i.test(text)) {
    return new WalletError('The Solana devnet RPC refused the request (rate limit or access policy). Wait a few seconds and retry, or set NEXT_PUBLIC_SOLANA_RPC_URL to a dedicated devnet RPC. Nothing was sent.', 403);
  }
  if (/blockhash not found|block height exceeded/i.test(text)) {
    return new WalletError('The payment took too long to approve and expired. Nothing was sent. Retry and approve promptly.', code);
  }
  if (/failed to fetch|network request failed|timed? ?out|econn|socket/i.test(text)) {
    const err = new WalletError('Lost the connection to Solana devnet while sending. The payment may have gone through: check Phantom activity before retrying, then use the verify option (Buy again / Finish payout), which will not charge twice.', code);
    err.uncertain = true;
    return err;
  }
  if (/insufficient|debit an account/i.test(text)) {
    return new WalletError('Not enough devnet SOL in this wallet for the amount plus the network fee. Fund it from a devnet faucet and retry. Nothing was sent.', code);
  }
  return new WalletError(text || 'Phantom could not complete the request.', code);
}

/** Connects (prompting if needed) and returns the wallet's public key. */
export async function connectPhantom(): Promise<PublicKey> {
  const phantom = requirePhantom();
  try { return (await phantom.connect()).publicKey; }
  catch (e) { throw explainWalletError(e, 'connect'); }
}

/**
 * Has the wallet sign the transaction, then broadcasts it to the given devnet connection. Returns the signature.
 * If Phantom answers "not authorised" (4100), reconnects once and retries before giving up.
 * Throws a WalletError with code 4001 when the person cancels; anything else means nothing was broadcast.
 */
export async function signAndSendDevnet(phantom: PhantomProvider, connection: Connection, tx: Transaction): Promise<string> {
  const sign = async () => {
    if (phantom.signTransaction) return phantom.signTransaction(tx);
    return null;
  };
  let signed: Transaction | null;
  try {
    try { signed = await sign(); }
    catch (e) {
      if (codeOf(e) !== 4100) throw e;
      await phantom.connect();
      signed = await sign();
    }
  } catch (e) { throw explainWalletError(e, 'sign'); }
  try {
    if (!signed) return (await phantom.signAndSendTransaction(tx)).signature;
    return await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed' });
  } catch (e) { throw explainWalletError(e, 'sign'); }
}
