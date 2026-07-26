import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  invoiceCounters,
  invoiceItems,
  invoices,
  customers,
  type InvoiceStatus,
} from "../db/schema.js";
import { computeInvoiceTotals, type LineInput } from "../domain/money.js";

export class NotFoundError extends Error {
  override name = "NotFoundError";
}
export class ConflictError extends Error {
  override name = "ConflictError";
}

export interface NewInvoiceInput {
  readonly businessId: string;
  readonly customerId: string;
  readonly dueDate: number;
  readonly notes?: string | undefined;
  readonly items: readonly (LineInput & { readonly description: string })[];
  readonly chargesVat: boolean;
}

export interface InvoiceRecord {
  readonly id: string;
  readonly number: string;
  readonly status: InvoiceStatus;
  readonly customerId: string;
  readonly issueDate: number;
  readonly dueDate: number;
  readonly subtotalKobo: number;
  readonly vatKobo: number;
  readonly totalKobo: number;
  readonly paidKobo: number;
  readonly shareToken: string;
  readonly notes: string | null;
}

/** Allocate the next sequential invoice number for a business, atomically. */
function nextInvoiceNumber(db: Db, businessId: string): string {
  db.insert(invoiceCounters).values({ businessId, nextNumber: 1 }).onConflictDoNothing().run();
  const row = db
    .update(invoiceCounters)
    .set({ nextNumber: sql`${invoiceCounters.nextNumber} + 1` })
    .where(eq(invoiceCounters.businessId, businessId))
    .returning({ allocated: invoiceCounters.nextNumber })
    .get();
  if (!row) throw new Error("invoice counter update returned no row");
  // `allocated` is the post-increment value; the number we use is one less.
  return `INV-${String(row.allocated - 1).padStart(6, "0")}`;
}

export function createInvoice(db: Db, input: NewInvoiceInput, now: number): InvoiceRecord {
  const customer = db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.businessId, input.businessId)))
    .get();
  if (!customer) throw new NotFoundError("customer not found");

  const totals = computeInvoiceTotals(input.items, input.chargesVat);

  return db.transaction((tx) => {
    const id = randomUUID();
    const number = nextInvoiceNumber(tx as unknown as Db, input.businessId);
    const shareToken = randomBytes(24).toString("base64url");
    tx.insert(invoices)
      .values({
        id,
        businessId: input.businessId,
        customerId: input.customerId,
        number,
        status: "draft",
        issueDate: now,
        dueDate: input.dueDate,
        subtotalKobo: totals.subtotalKobo,
        vatKobo: totals.vatKobo,
        totalKobo: totals.totalKobo,
        paidKobo: 0,
        shareToken,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const [i, item] of input.items.entries()) {
      const lineTotal = totals.lineTotalsKobo[i];
      if (lineTotal === undefined) throw new Error("line total missing"); // unreachable
      tx.insert(invoiceItems)
        .values({
          id: randomUUID(),
          invoiceId: id,
          description: item.description,
          quantity: item.quantity,
          unitPriceKobo: item.unitPriceKobo,
          lineTotalKobo: lineTotal,
        })
        .run();
    }
    return {
      id,
      number,
      status: "draft" as const,
      customerId: input.customerId,
      issueDate: now,
      dueDate: input.dueDate,
      subtotalKobo: totals.subtotalKobo,
      vatKobo: totals.vatKobo,
      totalKobo: totals.totalKobo,
      paidKobo: 0,
      shareToken,
      notes: input.notes ?? null,
    };
  });
}

/** Every read is scoped by businessId — IDOR is structurally impossible here. */
export function getInvoiceForBusiness(db: Db, businessId: string, invoiceId: string) {
  return (
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
      .get() ?? null
  );
}

export function listInvoices(db: Db, businessId: string, limit: number, offset: number) {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.businessId, businessId))
    .orderBy(desc(invoices.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
}

const ALLOWED_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  draft: ["sent", "void"],
  sent: ["part_paid", "paid", "void"],
  part_paid: ["paid", "void"],
  paid: [],
  void: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Owner action: mark a draft as sent (it becomes visible via share link + eligible for reminders). */
export function markInvoiceSent(db: Db, businessId: string, invoiceId: string, now: number): void {
  const inv = getInvoiceForBusiness(db, businessId, invoiceId);
  if (!inv) throw new NotFoundError("invoice not found");
  if (!canTransition(inv.status, "sent")) {
    throw new ConflictError(`cannot send an invoice in status '${inv.status}'`);
  }
  db.update(invoices)
    .set({ status: "sent", updatedAt: now })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .run();
}

export function voidInvoice(db: Db, businessId: string, invoiceId: string, now: number): void {
  const inv = getInvoiceForBusiness(db, businessId, invoiceId);
  if (!inv) throw new NotFoundError("invoice not found");
  if (!canTransition(inv.status, "void")) {
    throw new ConflictError(`cannot void an invoice in status '${inv.status}'`);
  }
  db.update(invoices)
    .set({ status: "void", updatedAt: now })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .run();
}
