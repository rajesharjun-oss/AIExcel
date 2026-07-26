import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  /** Absolute or cwd-relative path to the SQLite file. ":memory:" allowed in tests only. */
  DATABASE_PATH: z.string().min(1).default("data/invoiceng.db"),
  /** Public origin of the web app, used in share/payment links. No trailing slash. */
  APP_BASE_URL: z
    .string()
    .url()
    .transform((u) => u.replace(/\/+$/, ""))
    .default("http://localhost:5173"),
  /** Comma-separated list of allowed browser origins for CORS. */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 30),
  /** Secure cookies are mandatory outside development/test. */
  COOKIE_SECURE: z.coerce.boolean().default(false),
  PAYSTACK_MODE: z.enum(["off", "dry_run", "live"]).default("dry_run"),
  PAYSTACK_SECRET_KEY: z.string().min(1).optional(),
  SMS_MODE: z.enum(["off", "dry_run", "live"]).default("dry_run"),
  TERMII_API_KEY: z.string().min(1).optional(),
  TERMII_SENDER_ID: z.string().min(1).max(11).optional(),
  EINVOICE_MODE: z.enum(["off", "stub"]).default("off"),
  /** WhatsApp Cloud API (business-initiated template messages). Requires Meta verification. */
  WHATSAPP_MODE: z.enum(["off", "dry_run", "live"]).default("off"),
  WHATSAPP_TOKEN: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/).optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().min(1).default("payment_reminder"),
  WHATSAPP_TEMPLATE_LANG: z.string().min(2).max(10).default("en"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  corsOriginList: readonly string[];
};

/**
 * Parse and validate configuration from the environment. Fails fast with a
 * readable list of problems; never logs secret values.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;

  if (cfg.NODE_ENV === "production") {
    if (!cfg.COOKIE_SECURE) {
      throw new Error("Invalid configuration: COOKIE_SECURE must be true in production");
    }
    if (cfg.DATABASE_PATH === ":memory:") {
      throw new Error("Invalid configuration: DATABASE_PATH may not be :memory: in production");
    }
  }
  if (cfg.PAYSTACK_MODE === "live" && !cfg.PAYSTACK_SECRET_KEY) {
    throw new Error("Invalid configuration: PAYSTACK_SECRET_KEY is required when PAYSTACK_MODE=live");
  }
  if (cfg.SMS_MODE === "live" && (!cfg.TERMII_API_KEY || !cfg.TERMII_SENDER_ID)) {
    throw new Error(
      "Invalid configuration: TERMII_API_KEY and TERMII_SENDER_ID are required when SMS_MODE=live",
    );
  }
  if (cfg.WHATSAPP_MODE === "live" && (!cfg.WHATSAPP_TOKEN || !cfg.WHATSAPP_PHONE_NUMBER_ID)) {
    throw new Error(
      "Invalid configuration: WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WHATSAPP_MODE=live",
    );
  }

  const corsOriginList = cfg.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (corsOriginList.length === 0) {
    throw new Error("Invalid configuration: CORS_ORIGINS must contain at least one origin");
  }
  if (corsOriginList.includes("*")) {
    throw new Error("Invalid configuration: CORS_ORIGINS may not be a wildcard");
  }

  return { ...cfg, corsOriginList };
}
