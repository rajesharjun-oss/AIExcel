import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.js";
import { openDb, type DbHandle } from "../src/db/client.js";
import { buildApp } from "../src/app.js";
import { createPaystackClient } from "../src/services/paystack.js";
import { createSmsSender } from "../src/services/sms.js";
import { createEInvoiceProvider } from "../src/services/einvoice.js";

export interface TestContext {
  readonly app: FastifyInstance;
  readonly handle: DbHandle;
  readonly clock: { now: number };
  close(): Promise<void>;
}

export async function buildTestApp(): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    LOG_LEVEL: "error",
    // Rate limits high enough not to interfere with functional tests.
    CORS_ORIGINS: "http://localhost:5173",
  } as NodeJS.ProcessEnv);
  const handle = openDb(":memory:");
  const clock = { now: Date.UTC(2026, 0, 15, 12, 0, 0) };
  const app = await buildApp({
    config,
    db: handle.db,
    paystack: createPaystackClient("dry_run", undefined, config.APP_BASE_URL),
    sms: createSmsSender("dry_run", undefined, undefined),
    einvoice: createEInvoiceProvider("off"),
    now: () => clock.now,
  });
  await app.ready();
  return {
    app,
    handle,
    clock,
    close: async () => {
      await app.close();
      handle.close();
    },
  };
}

export interface TestAccount {
  readonly cookie: string;
  readonly businessId: string;
  readonly userId: string;
}

export async function signup(
  app: FastifyInstance,
  overrides: Partial<{ businessName: string; name: string; phone: string; password: string; chargesVat: boolean }> = {},
): Promise<TestAccount> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: {
      businessName: "Test Ventures",
      name: "Ada Test",
      phone: "08031234567",
      password: "correct-horse-9",
      chargesVat: true,
      ...overrides,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookieHeader) throw new Error("no session cookie returned");
  const cookie = cookieHeader.split(";")[0];
  if (!cookie) throw new Error("malformed session cookie");
  const body = res.json() as { businessId: string; userId: string };
  return { cookie, businessId: body.businessId, userId: body.userId };
}

export async function createCustomer(
  app: FastifyInstance,
  cookie: string,
  data: Partial<{ name: string; phone: string }> = {},
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/customers",
    headers: { cookie },
    payload: { name: "Chidi Buyer", phone: "08052223344", ...data },
  });
  if (res.statusCode !== 201) throw new Error(`createCustomer failed: ${res.body}`);
  return (res.json() as { id: string }).id;
}

export async function createInvoice(
  app: FastifyInstance,
  cookie: string,
  customerId: string,
  opts: Partial<{ dueDate: number; items: object[] }> = {},
): Promise<{ id: string; totalKobo: number; shareToken: string; number: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/invoices",
    headers: { cookie },
    payload: {
      customerId,
      dueDate: opts.dueDate ?? Date.UTC(2026, 0, 30),
      items: opts.items ?? [{ description: "Bags of rice", quantity: 2, unitPriceKobo: 5_000_000 }],
    },
  });
  if (res.statusCode !== 201) throw new Error(`createInvoice failed: ${res.body}`);
  return res.json() as { id: string; totalKobo: number; shareToken: string; number: string };
}
