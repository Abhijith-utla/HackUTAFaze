// @faze/shared (lead-owned) exports zod schemas but not every inferred type; derive here.
import type { z } from "zod";
import type { PacksResponse as P, CollectionResponse as C, MyTradesResponse as T } from "@faze/shared";
export type PacksResponse = z.infer<typeof P>;
export type CollectionResponse = z.infer<typeof C>;
export type MyTradesResponse = z.infer<typeof T>;

// TODO(@Abhijith-utla): replace with @faze/shared types once the Solana contract lands there.
export type SolBundle = { id: string; coins: number; priceCents?: number; lamports?: number };
export type SolCheckout = {
  purchaseId: string; recipient: string; lamports: number; reference: string;
  cluster: "devnet"; solanaPayUrl: string;
};
export type SolConfirm = { status: "paid"; credited: number; balance: number };
