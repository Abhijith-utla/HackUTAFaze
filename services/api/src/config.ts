import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// services/api/.env first, then the repo-root .env (first value wins).
loadEnv({ path: path.join(here, "..", ".env"), quiet: true } as never);
loadEnv({ path: path.join(here, "..", "..", "..", ".env"), quiet: true } as never);

const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;

function required(name: string, testFallback?: string): string {
  const v = process.env[name] || (isTest ? testFallback : undefined);
  if (!v) throw new Error(`Missing env var ${name} (see services/api/.env.example)`);
  return v;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL || "postgres://faze:faze@localhost:5432/faze",
  jwtSecret: required("JWT_SECRET", "test-jwt-secret"),
  internalSecret: required("INTERNAL_SECRET", "test-internal-secret"),
  port: Number(process.env.PORT || 4000),
  clientOrigins: (process.env.CLIENT_ORIGINS || "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  secureCookies: process.env.NODE_ENV === "production",
  /** Public base URL of this API, used to build absolute art URLs. */
  publicUrl: (process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, ""),
  /** Where uploaded card art is stored (v1.3). */
  artDir: process.env.ART_DIR || path.join(here, "..", "uploads"),
};
