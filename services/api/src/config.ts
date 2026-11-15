import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { databaseUrlFor } from "./database-config.js";

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
  uploadDir: path.resolve(process.env.UPLOAD_DIR || process.env.ART_DIR || path.join(here, "..", "..", "..", ".data", "uploads")),
  databaseUrl: databaseUrlFor(process.env, isTest),
  jwtSecret: required("JWT_SECRET", "test-jwt-secret"),
  internalSecret: required("INTERNAL_SECRET", "test-internal-secret"),
  port: Number(process.env.PORT || 4000),
  clientOrigins: (process.env.CLIENT_ORIGINS || "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  secureCookies: process.env.NODE_ENV === "production",
  /** Public base URL of this API. v1.5: artUrl is relative; this only identifies "own host" when normalising absolute input. */
  publicUrl: (process.env.PUBLIC_API_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, ""),
  /** Where uploaded card art is stored (v1.3). */
  artDir: process.env.ART_DIR || path.join(here, "..", "uploads"),
  /** D's committed demo content (read-only). */
  catalogPath: process.env.SEED_CATALOG || path.join(here, "..", "..", "..", "content", "seed", "catalog.json"),
  /** Twitch Helix (optional): app credentials from dev.twitch.tv/console. Never logged. */
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID || "",
    clientSecret: process.env.TWITCH_CLIENT_SECRET || "",
    channel: (process.env.TWITCH_CHANNEL || "faze").toLowerCase(),
  },
  demoArtDir: process.env.DEMO_ART_DIR || path.join(here, "..", "..", "..", "content", "seed", "art"),
};
