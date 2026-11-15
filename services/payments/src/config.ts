// Env config. Every var is documented in /.env.example. No secrets in code.
export type StripeMode = "live" | "fake";

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  internalSecret: string;
  apiUrl: string;
  paymentsUrl: string;
  clientUrl: string;
  stripeMode: StripeMode;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
}

function req(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`payments: missing env var ${name} (see .env.example)`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const stripeMode = (env.STRIPE_MODE ?? "fake") as StripeMode;
  if (stripeMode !== "live" && stripeMode !== "fake") {
    throw new Error(`payments: STRIPE_MODE must be "live" or "fake", got "${stripeMode}"`);
  }
  // "live" here means "talk to the real Stripe API" — still test mode only. Coins are never real money.
  const stripeSecretKey = stripeMode === "live" ? req(env, "STRIPE_SECRET_KEY") : env.STRIPE_SECRET_KEY ?? "sk_test_fake";
  if (!stripeSecretKey.startsWith("sk_test_")) {
    throw new Error("payments: refusing to start — STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)");
  }
  return {
    port: Number(env.PAYMENTS_PORT ?? 4100),
    databaseUrl: req(env, "DATABASE_URL"),
    jwtSecret: req(env, "JWT_SECRET"),
    internalSecret: req(env, "INTERNAL_SECRET"),
    apiUrl: env.API_URL ?? "http://localhost:4000",
    paymentsUrl: env.PAYMENTS_URL ?? "http://localhost:4100",
    clientUrl: env.CLIENT_URL ?? "http://localhost:3000",
    stripeMode,
    stripeSecretKey,
    stripeWebhookSecret: stripeMode === "live" ? req(env, "STRIPE_WEBHOOK_SECRET") : env.STRIPE_WEBHOOK_SECRET ?? "whsec_fake_local",
  };
}
