import { clipClashRoutes } from './routes/clip-clash.js';
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
import { artRoutes } from "./routes/art.js";
import { adminRoutes } from "./routes/admin.js";
import { controlRoutes } from "./routes/control.js"; // FaZe Control Room (lead, contract v1.6)
import { insightsRoutes } from "./routes/insights.js"; // Control Room analytics + sponsors (lead, v1.8)
import { contributionRoutes } from "./routes/contributions.js";

import { marketplaceRoutes } from './routes/marketplace.js';
import { pipelineRoutes } from "./routes/pipeline.js"; // clip/frame → face → card art (A, v1.9 draft)

import { paidPackRoutes, type PackChain } from './pack-payment.js';
import { type ContributionChain } from "./contributions.js";

export async function buildApp(options: { packChain?: PackChain; contributionChain?: ContributionChain } = {}) {
  const app = Fastify({ logger: process.env.VITEST ? false : { level: "info" } });
  await app.register(cookie);
  await app.register(cors, { origin: config.clientOrigins, credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] });
  registerErrorHandler(app);

  app.get("/health", async () => ({ ok: true }));
  app.get<{ Params: { file: string } }>("/demo-art/:file", async (req, reply) => {
    if (!/^[a-f0-9-]{36}\.svg$/i.test(req.params.file)) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Art not found" } });
    try {
      const art = await readFile(path.join(config.demoArtDir, req.params.file));
      return reply.type("image/svg+xml").header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox").send(art);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Art not found" } });
    }
  });
  await app.register(authRoutes);
  await app.register(internalRoutes);
  await app.register(packsRoutes);
  await paidPackRoutes(app,options.packChain);
  await app.register(collectionRoutes);
  await app.register(tradesRoutes);
  await app.register(marketplaceRoutes);
  await app.register(leaderboardRoutes);
  await app.register(adminRoutes);
  await contributionRoutes(app, options.contributionChain);
  await app.register(controlRoutes);
  await app.register(insightsRoutes);
  await app.register(pipelineRoutes);
  await artRoutes(app);
  await app.register(clipClashRoutes);
  return app;
}
