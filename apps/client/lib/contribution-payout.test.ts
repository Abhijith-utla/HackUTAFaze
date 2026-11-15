import assert from "node:assert/strict";
import test from "node:test";
import { validateContributionQuote } from "./contribution-payout";

const quote = {
  id: "proposal",
  reference: "11111111111111111111111111111112",
  recipient: "11111111111111111111111111111113",
  payerWallet: "11111111111111111111111111111114",
  lamports: 50_000_000,
  cluster: "devnet" as const,
};

test("contribution payouts only prepare the quote's devnet payer wallet", () => {
  assert.doesNotThrow(() => validateContributionQuote(quote, quote.payerWallet));
  assert.throws(() => validateContributionQuote({ ...quote, cluster: "mainnet" }, quote.payerWallet), /devnet/i);
  assert.throws(() => validateContributionQuote(quote, "another-wallet"), /quoted payer/i);
  assert.throws(() => validateContributionQuote({ ...quote, lamports: 0 }, quote.payerWallet), /amount/i);
});
