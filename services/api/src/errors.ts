import { ERROR_STATUS, type ErrorCode } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new AppError(code, message);
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(ERROR_STATUS[err.code]).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return reply.status(400).send({ error: { code: "VALIDATION", message } });
    }
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e.code === "23505") return reply.status(409).send({ error: { code: "CONFLICT", message: "Already exists" } });
    if (e.code === "22P02") return reply.status(400).send({ error: { code: "VALIDATION", message: "Malformed id" } });
    if (e.statusCode && e.statusCode < 500) {
      return reply.status(400).send({ error: { code: "VALIDATION", message: e.message ?? "Bad request" } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: "CONFLICT", message: "Internal error" } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }),
  );
}
