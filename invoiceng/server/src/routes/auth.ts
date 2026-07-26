import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { businesses, reminderSettings, users } from "../db/schema.js";
import { normalizeNgPhone } from "../domain/phone.js";
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "../services/passwords.js";
import { createSession, revokeSession } from "../services/sessions.js";
import { SESSION_COOKIE } from "../app.js";

const SignupSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  chargesVat: z.boolean().default(true),
});

const LoginSchema = z.object({
  phone: z.string().trim().min(7).max(20),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, now } = app.deps;

  const cookieOpts = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    path: "/",
  } as const;

  const strictLimit = {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };

  app.post("/signup", strictLimit, async (req, reply) => {
    const body = SignupSchema.parse(req.body);
    const phone = normalizeNgPhone(body.phone);

    const existing = db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).get();
    if (existing) {
      // Same shape as success-path errors; does not reveal which field failed lookup elsewhere.
      return reply.code(409).send({ error: "an account with this phone number already exists" });
    }

    const passwordHash = await hashPassword(body.password);
    const ts = now();
    const businessId = randomUUID();
    const userId = randomUUID();
    db.transaction((tx) => {
      tx.insert(businesses)
        .values({ id: businessId, name: body.businessName, chargesVat: body.chargesVat, createdAt: ts })
        .run();
      tx.insert(users)
        .values({
          id: userId,
          businessId,
          name: body.name,
          phone,
          email: body.email ?? null,
          passwordHash,
          createdAt: ts,
        })
        .run();
      tx.insert(reminderSettings).values({ businessId }).run();
    });

    const session = createSession(db, userId, config.SESSION_TTL_HOURS, ts);
    return reply
      .setCookie(SESSION_COOKIE, session.token, { ...cookieOpts, expires: new Date(session.expiresAt) })
      .code(201)
      .send({ userId, businessId, name: body.name, businessName: body.businessName });
  });

  app.post("/login", strictLimit, async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    let phone: string;
    try {
      phone = normalizeNgPhone(body.phone);
    } catch {
      return reply.code(401).send({ error: "phone number or password is incorrect" });
    }

    const user = db.select().from(users).where(eq(users.phone, phone)).get();
    // Verify against a constant dummy hash when the user is missing to keep
    // response timing independent of account existence.
    const hash =
      user?.passwordHash ??
      "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const ok = await verifyPassword(hash, body.password);
    if (!user || !ok) {
      return reply.code(401).send({ error: "phone number or password is incorrect" });
    }

    const session = createSession(db, user.id, config.SESSION_TTL_HOURS, now());
    const business = db
      .select({ name: businesses.name })
      .from(businesses)
      .where(eq(businesses.id, user.businessId))
      .get();
    return reply
      .setCookie(SESSION_COOKIE, session.token, { ...cookieOpts, expires: new Date(session.expiresAt) })
      .send({
        userId: user.id,
        businessId: user.businessId,
        name: user.name,
        businessName: business?.name ?? "",
      });
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) revokeSession(db, token, now());
    return reply.clearCookie(SESSION_COOKIE, cookieOpts).send({ ok: true });
  });

  app.get("/me", async (req, reply) => {
    if (!req.currentUser) return reply.code(401).send({ error: "please sign in" });
    const business = db
      .select({ name: businesses.name, chargesVat: businesses.chargesVat })
      .from(businesses)
      .where(eq(businesses.id, req.currentUser.businessId))
      .get();
    return {
      userId: req.currentUser.userId,
      businessId: req.currentUser.businessId,
      name: req.currentUser.name,
      phone: req.currentUser.phone,
      businessName: business?.name ?? "",
      chargesVat: business?.chargesVat ?? true,
    };
  });
}
