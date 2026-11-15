// Env config. Every var is documented in /.env.example. No secrets: the treasury is a PUBLIC key.
import { PublicKey } from "@solana/web3.js";
import { SolanaCluster } from "@faze/shared";

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  internalSecret: string;
  apiUrl: string;
  clientOrigins: string[];
  cluster: SolanaCluster;
  rpcUrl: string;
  treasury: string;
  /** Test-only: accept simulated signatures instead of reading the chain. Refused in production. */
  simulate: boolean;
}

function req(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`payments: missing env var ${name} (see .env.example)`);
  return v;
}

const DEFAULT_RPC: Record<SolanaCluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsedCluster = SolanaCluster.safeParse(env.SOLANA_CLUSTER ?? "devnet");
  if (!parsedCluster.success) {
    throw new Error(`payments: refusing to start — SOLANA_CLUSTER must be devnet, testnet or localnet (never mainnet)`);
  }
  const cluster = parsedCluster.data;
  const rpcUrl = env.SOLANA_RPC_URL ?? DEFAULT_RPC[cluster];
  if (/mainnet/i.test(rpcUrl)) {
    throw new Error("payments: refusing to start — SOLANA_RPC_URL points at mainnet; test payments only");
  }
  const treasury = req(env, "SOLANA_TREASURY_PUBKEY");
  try {
    new PublicKey(treasury);
  } catch {
    throw new Error("payments: SOLANA_TREASURY_PUBKEY is not a valid Solana public key");
  }
  const simulate = env.PAYMENTS_SIMULATE === "1";
  if (simulate && env.NODE_ENV === "production") {
    throw new Error("payments: PAYMENTS_SIMULATE is test-only and is refused when NODE_ENV=production");
  }
  const databaseUrl = req(env, "DATABASE_URL");
  const database = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("Database must use PostgreSQL URL");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname);
  if (!local && !["require", "verify-ca", "verify-full"].includes(database.searchParams.get("sslmode") || "")) {
    throw new Error("Remote Tiger Cloud connections require TLS sslmode=require or stricter");
  }
  if (env.NODE_ENV === 'production' && env.PAYMENTS_STANDALONE === '1') throw new Error('Standalone payments are test-only');
  return {
    port: Number(env.PAYMENTS_PORT ?? 4100),
    databaseUrl,
    jwtSecret: req(env, "JWT_SECRET"),
    internalSecret: req(env, "INTERNAL_SECRET"),
    apiUrl: env.API_URL ?? "http://localhost:4000",
    // Same variable as services/api; CLIENT_URL kept as a single-origin fallback.
    clientOrigins: (env.CLIENT_ORIGINS || env.CLIENT_URL || "http://localhost:3000,http://localhost:3001")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cluster,
    rpcUrl,
    treasury,
    simulate,
  };
}
