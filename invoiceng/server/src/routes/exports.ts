import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { customers, invoices, payments } from "../db/schema.js";
import { isoDate, koboToDecimalString, toCsv } from "../services/csv.js";

/**
 * Full data export, one CSV per entity. Deliberately unpaginated: the point
 * is that the owner can walk away with ALL their data at any time. Bounded
 * in practice by per-business volume; revisit with streaming if a business
 * exceeds ~100k rows.
 */
export async function exportRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  const csvReply = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.get("/customers.csv", csvReply, async (req, reply) => {
    const user = req.currentUser!;
    const rows = db
      .select()
      .from(customers)
      .where(eq(customers.businessId, user.businessId))
      .orderBy(desc(customers.createdAt))
      .all();
    const csv = toCsv(
      ["name", "phone", "email", "notes", "created_at"],
      rows.map((c) => [c.name, c.phone, c.email, c.notes, isoDate(c.createdAt)]),
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="customers.csv"')
      .send(csv);
  });

  app.get("/invoices.csv", csvReply, async (req, reply) => {
    const user = req.currentUser!;
    const rows = db
      .select({
        number: invoices.number,
        customerName: customers.name,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        subtotalKobo: invoices.subtotalKobo,
        vatKobo: invoices.vatKobo,
        totalKobo: invoices.totalKobo,
        paidKobo: invoices.paidKobo,
        notes: invoices.notes,
      })
      .from(invoices)
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(invoices.businessId, user.businessId))
      .orderBy(desc(invoices.createdAt))
      .all();
    const csv = toCsv(
      [
        "number",
        "customer",
        "status",
        "issued_at",
        "due_at",
        "subtotal_naira",
        "vat_naira",
        "total_naira",
        "paid_naira",
        "outstanding_naira",
        "notes",
      ],
      rows.map((r) => [
        r.number,
        r.customerName,
        r.status,
        isoDate(r.issueDate),
        isoDate(r.dueDate),
        koboToDecimalString(r.subtotalKobo),
        koboToDecimalString(r.vatKobo),
        koboToDecimalString(r.totalKobo),
        koboToDecimalString(r.paidKobo),
        koboToDecimalString(r.totalKobo - r.paidKobo),
        r.notes,
      ]),
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="invoices.csv"')
      .send(csv);
  });

  app.get("/payments.csv", csvReply, async (req, reply) => {
    const user = req.currentUser!;
    const rows = db
      .select({
        invoiceNumber: invoices.number,
        customerName: customers.name,
        amountKobo: payments.amountKobo,
        method: payments.method,
        reference: payments.reference,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(payments.businessId, user.businessId))
      .orderBy(desc(payments.paidAt))
      .all();
    const csv = toCsv(
      ["invoice", "customer", "amount_naira", "method", "reference", "paid_at"],
      rows.map((p) => [
        p.invoiceNumber,
        p.customerName,
        koboToDecimalString(p.amountKobo),
        p.method,
        p.reference,
        isoDate(p.paidAt),
      ]),
    );
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="payments.csv"')
      .send(csv);
  });
}
