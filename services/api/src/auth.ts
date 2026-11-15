import jwt from "jsonwebtoken";
import { SESSION_COOKIE, type Role, type SessionClaims } from "@faze/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { fail } from "./errors.js";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export function signSession(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role }, config.jwtSecret, { algorithm: "HS256", expiresIn: SEVEN_DAYS });
}

export function setSessionCookie(reply: FastifyReply, userId: string, role: Role) {
  reply.setCookie(SESSION_COOKIE, signSession(userId, role), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.secureCookies,
    maxAge: SEVEN_DAYS,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function readSession(req: FastifyRequest): SessionClaims | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const c = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as SessionClaims;
    return c && typeof c.sub === "string" ? c : null;
  } catch {
    return null;
  }
}

/** Returns the session or throws UNAUTHENTICATED. */
export function requireUser(req: FastifyRequest): SessionClaims {
  return readSession(req) ?? fail("UNAUTHENTICATED", "Sign in first");
}

/** Returns the session or throws UNAUTHENTICATED / FORBIDDEN. */
export function requireAdmin(req: FastifyRequest): SessionClaims {
  const s = requireUser(req);
  if (s.role !== "admin") fail("FORBIDDEN", "Admins only");
  return s;
}

export function requireInternal(req: FastifyRequest) {
  const got = req.headers["x-internal-secret"];
  if (typeof got !== "string" || got !== config.internalSecret) fail("FORBIDDEN", "Bad internal secret");
}
