import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/client.js";
import type { PaystackClient } from "./services/paystack.js";
import type { SmsSender } from "./services/reminders.js";
import type { EInvoiceProvider } from "./services/einvoice.js";
import { resolveSession, type SessionUser } from "./services/sessions.js";
import { MoneyError } from "./domain/money.js";
import { PhoneError } from "./domain/phone.js";
import { ConflictError, NotFoundError } from "./services/invoices.js";
import { authRoutes } from "./routes/auth.js";
import { customerRoutes } from "./routes/customers.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { publicRoutes } from "./routes/public.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { reminderRoutes } from "./routes/reminders.js";
import { exportRoutes } from "./routes/exports.js";

export interface AppDeps {
  readonly config: AppConfig;
  readonly db: Db;
  readonly paystack: PaystackClient;
  readonly sms: SmsSender;
  readonly einvoice: EInvoiceProvider;
  readonly now?: () => number;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: SessionUser | null;
    rawBody?: Buffer;
  }
  interface FastifyInstance {
    deps: AppDeps & { now: () => number };
  }
}

export const SESSION_COOKIE = "sid";

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const now = deps.now ?? (() => Date.now());

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.headers['x-paystack-signature']",
        ],
        censor: "[redacted]",
      },
    },
    genReqId: () => randomUUID(),
    bodyLimit: 256 * 1024,
    trustProxy: false,
  });

  app.decorate("deps", { ...deps, now });
  app.decorateRequest("currentUser", null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: [...config.corsOriginList],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  // CSRF defence in depth: cookies are SameSite=Strict; additionally reject
  // state-changing cross-origin requests whose Origin is not allowlisted.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    if (origin !== undefined && !config.corsOriginList.includes(origin)) {
      return reply.code(403).send({ error: "origin not allowed" });
    }
  });

  // Session resolution for every request; enforcement happens per route scope.
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.currentUser = token ? resolveSession(deps.db, token, now()) : null;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "validation failed",
        fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof MoneyError || err instanceof PhoneError) {
      return reply.code(400).send({ error: err.message });
    }
    if (err instanceof NotFoundError) {
      return reply.code(404).send({ error: "not found" });
    }
    if (err instanceof ConflictError) {
      return reply.code(409).send({ error: err.message });
    }
    const maybeHttp = err as { statusCode?: unknown; message?: unknown };
    const status = typeof maybeHttp.statusCode === "number" ? maybeHttp.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err, reqId: req.id }, "unhandled error");
      return reply.code(500).send({ error: "something went wrong on our side", reqId: req.id });
    }
    // Framework 4xx (rate limit, body too large, bad content type…): safe to pass message through.
    return reply
      .code(status)
      .send({ error: typeof maybeHttp.message === "string" ? maybeHttp.message : "request failed" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(publicRoutes, { prefix: "/api/pub" });
  await app.register(webhookRoutes, { prefix: "/api/webhooks" });

  // Authenticated scope.
  await app.register(async (scope) => {
    scope.addHook("onRequest", async (req, reply) => {
      if (!req.currentUser) {
        return reply.code(401).send({ error: "please sign in" });
      }
    });
    await scope.register(customerRoutes, { prefix: "/customers" });
    await scope.register(invoiceRoutes, { prefix: "/invoices" });
    await scope.register(reminderRoutes, { prefix: "/reminders" });
    await scope.register(exportRoutes, { prefix: "/export" });
  }, { prefix: "/api" });

  return app;
}
