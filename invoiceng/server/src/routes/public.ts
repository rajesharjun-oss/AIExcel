import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { businesses, customers, invoiceItems, invoices } from "../db/schema.js";
import { renderInvoicePdf } from "../services/pdf.js";

const ShareTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
});

const PayBodySchema = z.object({
  /** Payer email is required by Paystack; the customer types it at checkout. */
  email: z.string().trim().email().max(254),
});

/**
 * Customer-facing endpoints, addressed by unguessable share token only.
 * They intentionally expose the minimum: business name, invoice lines, balance.
 */
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  const { db, paystack, config, now } = app.deps;

  app.get("/invoices/:token", async (req, reply) => {
    const { token } = ShareTokenParamSchema.parse(req.params);
    const inv = db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        subtotalKobo: invoices.subtotalKobo,
        vatKobo: invoices.vatKobo,
        totalKobo: invoices.totalKobo,
        paidKobo: invoices.paidKobo,
        notes: invoices.notes,
        businessName: businesses.name,
        customerName: customers.name,
      })
      .from(invoices)
      .innerJoin(businesses, eq(invoices.businessId, businesses.id))
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.shareToken, token))
      .get();
    if (!inv || inv.status === "draft" || inv.status === "void") {
      return reply.code(404).send({ error: "invoice not found" });
    }
    const items = db
      .select({
        description: invoiceItems.description,
        quantity: invoiceItems.quantity,
        unitPriceKobo: invoiceItems.unitPriceKobo,
        lineTotalKobo: invoiceItems.lineTotalKobo,
      })
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, inv.id))
      .all();
    const { id: _id, ...publicInvoice } = inv;
    return { ...publicInvoice, items, paymentsEnabled: paystack.mode !== "off" };
  });

  app.get(
    "/invoices/:token/pdf",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { token } = ShareTokenParamSchema.parse(req.params);
      const inv = db
        .select({
          id: invoices.id,
          number: invoices.number,
          status: invoices.status,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          subtotalKobo: invoices.subtotalKobo,
          vatKobo: invoices.vatKobo,
          totalKobo: invoices.totalKobo,
          paidKobo: invoices.paidKobo,
          notes: invoices.notes,
          businessName: businesses.name,
          businessTin: businesses.tin,
          customerName: customers.name,
        })
        .from(invoices)
        .innerJoin(businesses, eq(invoices.businessId, businesses.id))
        .innerJoin(customers, eq(invoices.customerId, customers.id))
        .where(eq(invoices.shareToken, token))
        .get();
      if (!inv || inv.status === "draft" || inv.status === "void") {
        return reply.code(404).send({ error: "invoice not found" });
      }
      const items = db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id)).all();
      const pdf = await renderInvoicePdf({
        businessName: inv.businessName,
        businessTin: inv.businessTin,
        customerName: inv.customerName,
        number: inv.number,
        status: inv.status,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        items,
        subtotalKobo: inv.subtotalKobo,
        vatKobo: inv.vatKobo,
        totalKobo: inv.totalKobo,
        paidKobo: inv.paidKobo,
        notes: inv.notes,
        payUrl: inv.status === "paid" ? null : `${config.APP_BASE_URL}/i/${token}`,
      });
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${inv.number}.pdf"`)
        .send(pdf);
    },
  );

  app.post(
    "/invoices/:token/pay",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { token } = ShareTokenParamSchema.parse(req.params);
      const body = PayBodySchema.parse(req.body);
      const inv = db
        .select({
          id: invoices.id,
          status: invoices.status,
          totalKobo: invoices.totalKobo,
          paidKobo: invoices.paidKobo,
        })
        .from(invoices)
        .where(eq(invoices.shareToken, token))
        .get();
      if (!inv || inv.status === "draft" || inv.status === "void") {
        return reply.code(404).send({ error: "invoice not found" });
      }
      if (inv.status === "paid") {
        return reply.code(409).send({ error: "this invoice is already fully paid" });
      }
      const outstandingKobo = inv.totalKobo - inv.paidKobo;
      const reference = `png_${randomUUID().replaceAll("-", "")}`;
      const result = await paystack.initializeTransaction({
        email: body.email,
        amountKobo: outstandingKobo,
        reference,
        invoiceId: inv.id,
        callbackUrl: `${config.APP_BASE_URL}/i/${token}?paid=1`,
      });
      req.log.info(
        { invoiceId: inv.id, reference, dryRun: result.dryRun, at: now() },
        "checkout initialized",
      );
      return { authorizationUrl: result.authorizationUrl, reference: result.reference };
    },
  );
}
