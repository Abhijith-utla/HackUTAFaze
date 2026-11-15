// @faze/shared — types + zod schemas mirroring docs/api.md and docs/data-model.md (contract v1, frozen).
// Only the lead changes this file. Shipped as TS source: services run it via tsx; Next.js apps add
// `transpilePackages: ["@faze/shared"]` to next.config.
import { z } from "zod";

// ---------- enums ----------
export const Role = z.enum(["fan", "admin"]);
export const Rarity = z.enum(["common", "rare", "epic", "legendary"]);
export const ModerationStatus = z.enum(["pending", "approved", "rejected"]);
export const SetStatus = z.enum(["draft", "live", "retired"]);
export const TradeStatus = z.enum(["open", "accepted", "declined", "cancelled"]);
export const LedgerReason = z.enum(["signup_bonus", "pack_open", "purchase", "admin_grant"]);
export const SubmissionKind = z.enum(["display_name", "trade_message", "fan_art"]);
export const JobKind = z.enum(["engagement_spike", "publish_set", "moderate"]);
export const JobStatus = z.enum(["queued", "running", "done", "failed"]);
export const EngagementMetric = z.enum(["views", "likes", "mentions"]);

export const RARITY_SCORE: Record<z.infer<typeof Rarity>, number> = {
  common: 1,
  rare: 3,
  epic: 10,
  legendary: 25,
};
export const SIGNUP_BONUS_COINS = 500;

// ---------- errors ----------
export const ErrorCode = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "INSUFFICIENT_COINS",
  "CARD_LOCKED",
  "TRADE_NOT_OPEN",
  "CONFLICT",
]);
export const ERROR_STATUS: Record<z.infer<typeof ErrorCode>, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  INSUFFICIENT_COINS: 409,
  CARD_LOCKED: 409,
  TRADE_NOT_OPEN: 409,
  CONFLICT: 409,
};
export const ApiError = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});

// ---------- auth ----------
export const SessionClaims = z.object({ sub: z.string().uuid(), role: Role, exp: z.number() });
export const SESSION_COOKIE = "session";

// ---------- objects ----------
export const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  displayNameStatus: ModerationStatus,
  role: Role,
  demo: z.boolean(),
  createdAt: z.string(),
});
export const PublicUser = User.pick({ id: true, displayName: true });

export const CardSet = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  status: SetStatus,
  demo: z.boolean(),
  publishedAt: z.string().nullable(),
});

export const Card = z.object({
  id: z.string().uuid(),
  setId: z.string().uuid(),
  name: z.string(),
  fazeMember: z.string(),
  rarity: Rarity,
  artUrl: z.string(),
  basePower: z.number().int(),
  maxSupply: z.number().int().positive().nullable(),
  demo: z.boolean(),
});

export const CardInstance = z.object({
  id: z.string().uuid(),
  card: Card,
  serial: z.number().int().positive(),
  locked: z.boolean(),
  acquiredAt: z.string(),
});

export const Odds = z.record(Rarity, z.number().min(0).max(100));
export const Pack = z.object({
  id: z.string().uuid(),
  name: z.string(),
  setId: z.string().uuid(),
  priceCoins: z.number().int().positive(),
  cardsPerPack: z.number().int().positive(),
  odds: Odds,
  oddsVersion: z.number().int(),
});

export const Trade = z.object({
  id: z.string().uuid(),
  fromUser: PublicUser,
  toUser: PublicUser,
  offeredInstanceIds: z.array(z.string().uuid()),
  requestedInstanceIds: z.array(z.string().uuid()),
  message: z.string().nullable(),
  messageStatus: ModerationStatus.nullable(),
  status: TradeStatus,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export const Bundle = z.object({
  id: z.string(),
  coins: z.number().int().positive(),
  priceCents: z.number().int().positive(),
});

export const Purchase = z.object({
  id: z.string().uuid(),
  bundleId: z.string(),
  coins: z.number().int(),
  amountCents: z.number().int(),
  testMode: z.boolean(),
  status: z.enum(["pending", "paid", "failed"]),
  createdAt: z.string(),
});

export const Submission = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kind: SubmissionKind,
  refId: z.string().uuid().nullable(),
  payload: z.record(z.unknown()),
  status: ModerationStatus,
  autoFlags: z.array(z.string()),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const CollectionEntry = z.object({
  card: Card,
  instances: z.array(z.object({ id: z.string().uuid(), serial: z.number().int(), locked: z.boolean() })),
  count: z.number().int(),
});

// ---------- requests ----------
export const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(24),
});
export const LoginBody = z.object({ email: z.string().email(), password: z.string() });
export const OpenPackBody = z.object({ idempotencyKey: z.string().min(8) });
export const CreateTradeBody = z.object({
  toUserId: z.string().uuid(),
  offeredInstanceIds: z.array(z.string().uuid()),
  requestedInstanceIds: z.array(z.string().uuid()),
  message: z.string().max(200).optional(),
});
export const CheckoutBody = z.object({ bundleId: z.string() });
export const LedgerCreditBody = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive(),
  reason: LedgerReason,
  refId: z.string(),
  idempotencyKey: z.string(),
});
export const ModerationDecisionBody = z.object({ decision: z.enum(["approve", "reject"]) });
export const SpikeBody = z.object({ fazeMember: z.string() });
export const INTERNAL_SECRET_HEADER = "x-internal-secret";

// ---------- responses ----------
export const MeResponse = z.object({ user: User, balance: z.number().int() });
export const PacksResponse = z.object({ packs: z.array(Pack) });
export const OpenPackResponse = z.object({
  pullId: z.string().uuid(),
  cards: z.array(CardInstance),
  balance: z.number().int(),
});
export const CollectionResponse = z.object({ cards: z.array(CollectionEntry) });
export const LeaderboardResponse = z.object({
  collectors: z.array(z.object({ user: PublicUser, score: z.number().int() })),
  trending: z.array(z.object({ card: Card, hype: z.number().int() })),
});
export const MyTradesResponse = z.object({ incoming: z.array(Trade), outgoing: z.array(Trade) });
export const BundlesResponse = z.object({ bundles: z.array(Bundle), testMode: z.literal(true) });
export const CheckoutResponse = z.object({ checkoutUrl: z.string().url() });
export const PurchasesResponse = z.object({ purchases: z.array(Purchase) });
export const LedgerCreditResponse = z.object({ balance: z.number().int() });

// ---------- inferred types ----------
export type Role = z.infer<typeof Role>;
export type Rarity = z.infer<typeof Rarity>;
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ApiError = z.infer<typeof ApiError>;
export type SessionClaims = z.infer<typeof SessionClaims>;
export type User = z.infer<typeof User>;
export type PublicUser = z.infer<typeof PublicUser>;
export type CardSet = z.infer<typeof CardSet>;
export type Card = z.infer<typeof Card>;
export type CardInstance = z.infer<typeof CardInstance>;
export type Pack = z.infer<typeof Pack>;
export type Trade = z.infer<typeof Trade>;
export type Bundle = z.infer<typeof Bundle>;
export type Purchase = z.infer<typeof Purchase>;
export type Submission = z.infer<typeof Submission>;
export type CollectionEntry = z.infer<typeof CollectionEntry>;
export type LedgerCreditBody = z.infer<typeof LedgerCreditBody>;
export type MeResponse = z.infer<typeof MeResponse>;
export type OpenPackResponse = z.infer<typeof OpenPackResponse>;
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;
export type BundlesResponse = z.infer<typeof BundlesResponse>;
export type CheckoutResponse = z.infer<typeof CheckoutResponse>;
export type PurchasesResponse = z.infer<typeof PurchasesResponse>;
