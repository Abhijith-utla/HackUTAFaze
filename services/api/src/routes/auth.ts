import bcrypt from "bcryptjs";
import { LoginBody, SIGNUP_BONUS_COINS, SignupBody } from "@faze/shared";
import type { FastifyInstance } from "fastify";
import { clearSessionCookie, requireUser, setSessionCookie } from "../auth.js";
import { pool, tx } from "../db.js";
import { fail } from "../errors.js";
import { balanceOf, postEntry } from "../ledger.js";
import { toUser } from "../mappers.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup", async (req, reply) => {
    const body = SignupBody.parse(req.body);
    const email = body.email.trim().toLowerCase();
    const hash = await bcrypt.hash(body.password, 10);
    const user = await tx(async (c) => {
      const exists = await c.query("SELECT 1 FROM users WHERE email=$1", [email]);
      if (exists.rowCount) fail("CONFLICT", "Email already registered");
      const u = await c.query(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING *",
        [email, hash, body.displayName.trim()],
      );
      const row = u.rows[0];
      await postEntry(c, {
        userId: row.id,
        amount: SIGNUP_BONUS_COINS,
        reason: "signup_bonus",
        refId: row.id,
        idempotencyKey: `signup_bonus:${row.id}`,
        demo: true,
      });
      await c.query(
        "INSERT INTO submissions (user_id, kind, ref_id, payload) VALUES ($1,'display_name',$1,$2)",
        [row.id, { displayName: row.display_name }],
      );
      return row;
    });
    setSessionCookie(reply, user.id, user.role);
    return reply.status(201).send({ user: toUser(user) });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const r = await pool.query("SELECT * FROM users WHERE email=$1", [body.email.trim().toLowerCase()]);
    const row = r.rows[0];
    if (!row || !(await bcrypt.compare(body.password, row.password_hash))) {
      fail("UNAUTHENTICATED", "Wrong email or password");
    }
    setSessionCookie(reply, row.id, row.role);
    return { user: toUser(row) };
  });

  // Demo-only Control Room entry: the hackathon has one seeded administrator.
  // The form still requires an email and password, but neither is a credential here.
  app.post("/auth/admin-login", async (req, reply) => {
    LoginBody.parse(req.body);
    const r = await pool.query("SELECT * FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1");
    const row = r.rows[0];
    if (!row) fail("NOT_FOUND", "No demo administrator is available");
    setSessionCookie(reply, row.id, row.role);
    return { user: toUser(row) };
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get("/me", async (req) => {
    const s = requireUser(req);
    const r = await pool.query("SELECT * FROM users WHERE id=$1", [s.sub]);
    if (!r.rowCount) fail("UNAUTHENTICATED", "Account no longer exists");
    return { user: toUser(r.rows[0]), balance: await balanceOf(pool, s.sub) };
  });
}
