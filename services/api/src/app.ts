import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerErrorHandler } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { internalRoutes } from "./routes/internal.js";
import { packsRoutes } from "./routes/packs.js";
import { collectionRoutes } from "./routes/collection.js";
import { tradesRoutes } from "./routes/trades.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { adminRoutes } from "./routes/admin.js";
import { artRoutes } from "./routes/art.js";

export async function buildApp() {
  const app = Fastify({ logger: process.env.VITEST ? false : { level: "info" } });
  await app.register(cookie);
  await app.register(cors, { origin: config.clientOrigins, credentials: true });
  registerErrorHandler(app);

  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(internalRoutes);
  await app.register(packsRoutes);
  await app.register(collectionRoutes);
  await app.register(tradesRoutes);
  await app.register(leaderboardRoutes);
  await app.register(adminRoutes);
  await app.register(artRoutes);
  return app;
}
