import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { buildApp } from "./app.js";
import { createPaystackClient } from "./services/paystack.js";
import { createSmsSender } from "./services/sms.js";
import { createEInvoiceProvider } from "./services/einvoice.js";
import { createWhatsAppSender } from "./services/whatsapp.js";
import { runReminderTick } from "./services/reminders.js";

const REMINDER_TICK_MS = 60_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = openDb(config.DATABASE_PATH);
  const paystack = createPaystackClient(config.PAYSTACK_MODE, config.PAYSTACK_SECRET_KEY, config.APP_BASE_URL);
  const sms = createSmsSender(config.SMS_MODE, config.TERMII_API_KEY, config.TERMII_SENDER_ID);
  const einvoice = createEInvoiceProvider(config.EINVOICE_MODE);
  const wa = createWhatsAppSender({
    mode: config.WHATSAPP_MODE,
    token: config.WHATSAPP_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    templateName: config.WHATSAPP_TEMPLATE_NAME,
    templateLang: config.WHATSAPP_TEMPLATE_LANG,
  });

  const app = await buildApp({ config, db: handle.db, paystack, sms, einvoice });

  let tickRunning = false;
  const interval = setInterval(() => {
    if (tickRunning) return; // never overlap ticks
    tickRunning = true;
    runReminderTick(
      { db: handle.db, appBaseUrl: config.APP_BASE_URL, sms, wa, log: app.log },
      Date.now(),
    )
      .catch((err: unknown) => {
        app.log.error({ err }, "reminder tick failed");
      })
      .finally(() => {
        tickRunning = false;
      });
  }, REMINDER_TICK_MS);
  interval.unref();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    clearInterval(interval);
    await app.close();
    handle.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err: unknown) => {
  // Startup failures must be loud and terminal.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
