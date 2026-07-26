import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { businesses, customers, invoiceItems, PAYMENT_METHODS } from "../db/schema.js";
import { renderInvoicePdf } from "../services/pdf.js";
import { MAX_AMOUNT_KOBO } from "../domain/money.js";
import {
  createInvoice,
  getInvoiceForBusiness,
  listInvoices,
  markInvoiceSent,
  voidInvoice,
} from "../services/invoices.js";
import { recordPayment } from "../services/payments.js";

const LineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPriceKobo: z.number().int().min(0).max(MAX_AMOUNT_KOBO),
});

const CreateInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  dueDate: z.number().int().positive(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(LineSchema).min(1).max(100),
});

const RecordPaymentSchema = z.object({
  amountKobo: z.number().int().min(1).max(MAX_AMOUNT_KOBO),
  method: z.enum(PAYMENT_METHODS).exclude(["paystack"]),
  paidAt: z.number().int().positive().optional(),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const IdParamSchema = z.object({ id: z.string().uuid() });

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  const { db, now } = app.deps;

  app.post("/", async (req, reply) => {
    const user = req.currentUser!;
    const body = CreateInvoiceSchema.parse(req.body);
    const business = db
      .select({ chargesVat: businesses.chargesVat })
      .from(businesses)
      .where(eq(businesses.id, user.businessId))
      .get();
    const invoice = createInvoice(
      db,
      {
        businessId: user.businessId,
        customerId: body.customerId,
        dueDate: body.dueDate,
        notes: body.notes,
        items: body.items,
        chargesVat: business?.chargesVat ?? true,
      },
      now(),
    );
    return reply.code(201).send(invoice);
  });

  app.get("/", async (req) => {
    const user = req.currentUser!;
    const q = ListQuerySchema.parse(req.query);
    const rows = listInvoices(db, user.businessId, q.limit, q.offset);
    return { invoices: rows, limit: q.limit, offset: q.offset };
  });

  app.get("/:id", async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    const invoice = getInvoiceForBusiness(db, user.businessId, id);
    if (!invoice) return reply.code(404).send({ error: "not found" });
    const items = db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).all();
    return { ...invoice, items };
  });

  app.post("/:id/send", async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    markInvoiceSent(db, user.businessId, id, now());
    return reply.send({ ok: true });
  });

  app.post("/:id/void", async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    voidInvoice(db, user.businessId, id, now());
    return reply.send({ ok: true });
  });

  app.get("/:id/pdf", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    const invoice = getInvoiceForBusiness(db, user.businessId, id);
    if (!invoice) return reply.code(404).send({ error: "not found" });
    const business = db
      .select({ name: businesses.name, tin: businesses.tin })
      .from(businesses)
      .where(eq(businesses.id, user.businessId))
      .get();
    const customer = db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, invoice.customerId))
      .get();
    const items = db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).all();
    const pdf = await renderInvoicePdf({
      businessName: business?.name ?? "",
      businessTin: business?.tin ?? null,
      customerName: customer?.name ?? "",
      number: invoice.number,
      status: invoice.status,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      items,
      subtotalKobo: invoice.subtotalKobo,
      vatKobo: invoice.vatKobo,
      totalKobo: invoice.totalKobo,
      paidKobo: invoice.paidKobo,
      notes: invoice.notes,
      payUrl:
        invoice.status === "sent" || invoice.status === "part_paid"
          ? `${app.deps.config.APP_BASE_URL}/i/${invoice.shareToken}`
          : null,
    });
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="${invoice.number}.pdf"`)
      .send(pdf);
  });

  /** Manual payment (cash / bank transfer) recorded by the owner. */
  app.post("/:id/payments", async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    const body = RecordPaymentSchema.parse(req.body);
    const ts = now();
    const result = recordPayment(
      db,
      {
        businessId: user.businessId,
        invoiceId: id,
        amountKobo: body.amountKobo,
        method: body.method,
        recordedByUserId: user.userId,
        paidAt: body.paidAt ?? ts,
      },
      ts,
    );
    return reply.code(201).send(result);
  });
}
