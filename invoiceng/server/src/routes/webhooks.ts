import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { invoices, webhookEvents } from "../db/schema.js";
import { PaystackChargeEventSchema } from "../services/paystack.js";
import { recordPayment } from "../services/payments.js";

/**
 * Paystack webhook.
 * Order of operations: verify signature on the RAW body -> parse -> idempotency
 * gate -> apply. Always 200 after signature verification so Paystack does not
 * retry events we have consciously decided to skip; unverifiable requests get 401.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const { db, paystack, now } = app.deps;

  // Keep the raw body: HMAC must be computed over exact bytes, not re-serialized JSON.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/paystack", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-paystack-signature"];
    if (!paystack.verifyWebhookSignature(rawBody, typeof signature === "string" ? signature : undefined)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      req.log.warn("paystack webhook: unparseable body");
      return reply.code(400).send({ error: "invalid payload" });
    }

    const parsed = PaystackChargeEventSchema.safeParse(json);
    if (!parsed.success) {
      // Unknown event shapes are fine — acknowledge and move on.
      req.log.info("paystack webhook: ignoring unrecognized event shape");
      return reply.send({ ok: true });
    }
    const event = parsed.data;
    if (event.event !== "charge.success" || event.data.status !== "success") {
      return reply.send({ ok: true });
    }
    if (event.data.currency !== "NGN") {
      req.log.warn({ currency: event.data.currency }, "paystack webhook: non-NGN charge ignored");
      return reply.send({ ok: true });
    }
    const invoiceId = event.data.metadata?.invoice_id;
    if (!invoiceId) {
      req.log.warn({ reference: event.data.reference }, "paystack webhook: missing invoice metadata");
      return reply.send({ ok: true });
    }

    const ts = now();
    const eventKey = `paystack:${event.data.id}`;
    const inserted = db
      .insert(webhookEvents)
      .values({ id: eventKey, provider: "paystack", receivedAt: ts })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) {
      return reply.send({ ok: true, duplicate: true });
    }

    const invoice = db
      .select({ businessId: invoices.businessId, totalKobo: invoices.totalKobo, paidKobo: invoices.paidKobo })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .get();
    if (!invoice) {
      req.log.warn({ invoiceId }, "paystack webhook: invoice not found");
      return reply.send({ ok: true });
    }

    // Clamp overpayment to the outstanding balance; the excess is logged for
    // manual follow-up rather than corrupting the ledger or dropping the event.
    const outstanding = invoice.totalKobo - invoice.paidKobo;
    const amountKobo = Math.min(event.data.amount, outstanding);
    if (event.data.amount > outstanding) {
      req.log.warn(
        { invoiceId, received: event.data.amount, outstanding },
        "paystack webhook: overpayment clamped",
      );
    }
    if (amountKobo <= 0) {
      req.log.warn({ invoiceId }, "paystack webhook: nothing outstanding, payment ignored");
      return reply.send({ ok: true });
    }

    recordPayment(
      db,
      {
        businessId: invoice.businessId,
        invoiceId,
        amountKobo,
        method: "paystack",
        reference: event.data.reference,
        paidAt: ts,
      },
      ts,
    );
    db.update(webhookEvents).set({ processedAt: ts }).where(eq(webhookEvents.id, eventKey)).run();
    req.log.info({ invoiceId, amountKobo }, "paystack payment recorded");
    return reply.send({ ok: true });
  });
}
