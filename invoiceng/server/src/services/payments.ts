import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { invoices, payments, type PaymentMethod } from "../db/schema.js";
import { assertValidAmountKobo } from "../domain/money.js";
import { ConflictError, NotFoundError } from "./invoices.js";

export interface RecordPaymentInput {
  readonly businessId: string;
  readonly invoiceId: string;
  readonly amountKobo: number;
  readonly method: PaymentMethod;
  readonly reference?: string | undefined;
  readonly recordedByUserId?: string | undefined;
  readonly paidAt: number;
}

export interface PaymentResult {
  readonly paymentId: string;
  readonly newPaidKobo: number;
  readonly newStatus: "part_paid" | "paid";
  /** True when an identical reference was already recorded (idempotent replay). */
  readonly duplicate: boolean;
}

/**
 * Record a payment against an invoice and roll the invoice status forward.
 * Runs in a transaction; a duplicate provider reference is a no-op (idempotency).
 * Overpayment is rejected — an SME overpay is almost always a typo, and
 * accepting it silently corrupts the books.
 */
export function recordPayment(db: Db, input: RecordPaymentInput, now: number): PaymentResult {
  assertValidAmountKobo(input.amountKobo, "payment amount");
  if (input.amountKobo === 0) throw new ConflictError("payment amount must be greater than zero");

  return db.transaction((tx) => {
    if (input.reference !== undefined) {
      const existing = tx
        .select({ id: payments.id, invoiceId: payments.invoiceId })
        .from(payments)
        .where(eq(payments.reference, input.reference))
        .get();
      if (existing) {
        const inv = tx
          .select({ paidKobo: invoices.paidKobo, status: invoices.status })
          .from(invoices)
          .where(eq(invoices.id, existing.invoiceId))
          .get();
        return {
          paymentId: existing.id,
          newPaidKobo: inv?.paidKobo ?? 0,
          newStatus: inv?.status === "paid" ? "paid" : "part_paid",
          duplicate: true,
        } satisfies PaymentResult;
      }
    }

    const inv = tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.businessId, input.businessId)))
      .get();
    if (!inv) throw new NotFoundError("invoice not found");
    if (inv.status === "void") throw new ConflictError("cannot pay a voided invoice");
    if (inv.status === "paid") throw new ConflictError("invoice is already fully paid");
    if (inv.status === "draft") throw new ConflictError("send the invoice before recording payments");

    const newPaidKobo = inv.paidKobo + input.amountKobo;
    if (newPaidKobo > inv.totalKobo) {
      throw new ConflictError(
        `payment exceeds balance: outstanding is ${inv.totalKobo - inv.paidKobo} kobo`,
      );
    }
    const newStatus = newPaidKobo === inv.totalKobo ? "paid" : "part_paid";

    const paymentId = randomUUID();
    tx.insert(payments)
      .values({
        id: paymentId,
        businessId: input.businessId,
        invoiceId: input.invoiceId,
        amountKobo: input.amountKobo,
        method: input.method,
        reference: input.reference ?? null,
        paidAt: input.paidAt,
        recordedByUserId: input.recordedByUserId ?? null,
        createdAt: now,
      })
      .run();
    tx.update(invoices)
      .set({ paidKobo: newPaidKobo, status: newStatus, updatedAt: now })
      .where(eq(invoices.id, input.invoiceId))
      .run();

    return { paymentId, newPaidKobo, newStatus, duplicate: false } satisfies PaymentResult;
  });
}
