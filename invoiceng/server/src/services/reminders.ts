import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  businesses,
  customers,
  invoices,
  reminderSettings,
  reminders,
  type ReminderChannel,
} from "../db/schema.js";
import { formatNaira } from "../domain/money.js";
import { toWaMeNumber } from "../domain/phone.js";
import type { WhatsAppSender } from "./whatsapp.js";

const DAY_MS = 86_400_000;

export interface SmsSender {
  /** Returns "sent" | "skipped_dry_run"; throws on hard failure. */
  send(toE164: string, message: string): Promise<"sent" | "skipped_dry_run">;
}

export interface ReminderContext {
  readonly db: Db;
  readonly appBaseUrl: string;
  readonly sms: SmsSender;
  readonly wa: WhatsAppSender;
  readonly log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export function renderReminderMessage(args: {
  businessName: string;
  customerName: string;
  invoiceNumber: string;
  outstandingKobo: number;
  dueDate: number;
  overdue: boolean;
  payUrl: string;
}): string {
  const due = new Date(args.dueDate).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const opening = args.overdue
    ? `this is a gentle reminder that ${formatNaira(args.outstandingKobo)} on invoice ${args.invoiceNumber} was due on ${due}.`
    : `invoice ${args.invoiceNumber} for ${formatNaira(args.outstandingKobo)} is due on ${due}.`;
  return (
    `Hello ${args.customerName}, ${opening} ` +
    `Please pay via ${args.payUrl} or reply to arrange payment. Thank you — ${args.businessName}.`
  );
}

interface Occurrence {
  readonly seq: number;
  readonly scheduledFor: number;
}

/**
 * Pure function: which reminder occurrences exist for an invoice given settings?
 * seq 0 = pre-due nudge; seq 1..N = post-due, every N days after the due date.
 */
export function occurrencesFor(
  dueDate: number,
  settings: { daysBeforeDue: number; everyNDaysAfterDue: number; maxAfterDueCount: number },
): Occurrence[] {
  const out: Occurrence[] = [];
  if (settings.daysBeforeDue > 0) {
    out.push({ seq: 0, scheduledFor: dueDate - settings.daysBeforeDue * DAY_MS });
  }
  for (let i = 1; i <= settings.maxAfterDueCount; i++) {
    out.push({ seq: i, scheduledFor: dueDate + i * settings.everyNDaysAfterDue * DAY_MS });
  }
  return out;
}

/**
 * One scheduler tick. Idempotent: the unique index on (invoice_id, seq, channel)
 * means a crashed or overlapping tick can never double-create an occurrence,
 * and dispatch only touches rows in 'ready'.
 */
export async function runReminderTick(ctx: ReminderContext, now: number): Promise<void> {
  materializeDueOccurrences(ctx, now);
  await dispatchReadyReminders(ctx, now);
}

function materializeDueOccurrences(ctx: ReminderContext, now: number): void {
  const openInvoices = ctx.db
    .select({
      id: invoices.id,
      businessId: invoices.businessId,
      customerId: invoices.customerId,
      number: invoices.number,
      dueDate: invoices.dueDate,
      totalKobo: invoices.totalKobo,
      paidKobo: invoices.paidKobo,
      shareToken: invoices.shareToken,
      businessName: businesses.name,
      customerName: customers.name,
      customerPhone: customers.phone,
      enabled: reminderSettings.enabled,
      daysBeforeDue: reminderSettings.daysBeforeDue,
      everyNDaysAfterDue: reminderSettings.everyNDaysAfterDue,
      maxAfterDueCount: reminderSettings.maxAfterDueCount,
    })
    .from(invoices)
    .innerJoin(businesses, eq(invoices.businessId, businesses.id))
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .innerJoin(reminderSettings, eq(reminderSettings.businessId, invoices.businessId))
    .where(and(inArray(invoices.status, ["sent", "part_paid"]), eq(reminderSettings.enabled, true)))
    .all();

  for (const inv of openInvoices) {
    const outstandingKobo = inv.totalKobo - inv.paidKobo;
    if (outstandingKobo <= 0) continue;
    const settings = {
      daysBeforeDue: inv.daysBeforeDue,
      everyNDaysAfterDue: inv.everyNDaysAfterDue,
      maxAfterDueCount: inv.maxAfterDueCount,
    };
    for (const occ of occurrencesFor(inv.dueDate, settings)) {
      if (occ.scheduledFor > now) continue;
      const payUrl = `${ctx.appBaseUrl}/i/${inv.shareToken}`;
      const message = renderReminderMessage({
        businessName: inv.businessName,
        customerName: inv.customerName,
        invoiceNumber: inv.number,
        outstandingKobo,
        dueDate: inv.dueDate,
        overdue: occ.seq > 0,
        payUrl,
      });
      const channels: ReminderChannel[] = ["sms"];
      if (inv.customerPhone) {
        // Automated WhatsApp replaces the manual tap-to-send outbox when enabled.
        channels.push(ctx.wa.mode === "off" ? "wa_link" : "wa_auto");
      }
      for (const channel of channels) {
        const waLink =
          channel === "wa_link" && inv.customerPhone
            ? `https://wa.me/${toWaMeNumber(inv.customerPhone)}?text=${encodeURIComponent(message)}`
            : null;
        ctx.db
          .insert(reminders)
          .values({
            id: randomUUID(),
            businessId: inv.businessId,
            invoiceId: inv.id,
            seq: occ.seq,
            channel,
            status: "ready",
            scheduledFor: occ.scheduledFor,
            waLink,
            message,
            createdAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
    }
  }
}

async function dispatchReadyReminders(ctx: ReminderContext, now: number): Promise<void> {
  const ready = ctx.db
    .select({
      id: reminders.id,
      invoiceId: reminders.invoiceId,
      channel: reminders.channel,
      message: reminders.message,
      customerPhone: customers.phone,
      customerName: customers.name,
      invoiceNumber: invoices.number,
      totalKobo: invoices.totalKobo,
      paidKobo: invoices.paidKobo,
      shareToken: invoices.shareToken,
    })
    .from(reminders)
    .innerJoin(invoices, eq(reminders.invoiceId, invoices.id))
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(and(eq(reminders.status, "ready"), lte(reminders.scheduledFor, now)))
    .limit(100)
    .all();

  for (const r of ready) {
    // wa_link stays 'ready' — it is the owner's tap-to-send outbox.
    if (r.channel !== "sms" && r.channel !== "wa_auto") continue;
    if (!r.customerPhone) {
      ctx.db.update(reminders).set({ status: "skipped_dry_run" }).where(eq(reminders.id, r.id)).run();
      continue;
    }
    try {
      const outcome =
        r.channel === "sms"
          ? await ctx.sms.send(r.customerPhone, r.message)
          : await ctx.wa.sendReminderTemplate(r.customerPhone, {
              customerName: r.customerName,
              invoiceNumber: r.invoiceNumber,
              amount: formatNaira(r.totalKobo - r.paidKobo),
              payUrl: `${ctx.appBaseUrl}/i/${r.shareToken}`,
            });
      ctx.db
        .update(reminders)
        .set({ status: outcome === "sent" ? "sent" : "skipped_dry_run", sentAt: now })
        .where(eq(reminders.id, r.id))
        .run();
      ctx.log.info(
        { reminderId: r.id, invoiceId: r.invoiceId, channel: r.channel, outcome },
        "reminder dispatched",
      );
    } catch (err) {
      ctx.db.update(reminders).set({ status: "failed" }).where(eq(reminders.id, r.id)).run();
      ctx.log.warn(
        { reminderId: r.id, invoiceId: r.invoiceId, err: err instanceof Error ? err.message : "unknown" },
        "reminder dispatch failed",
      );
    }
  }
}

/** Mark a wa_link reminder as sent after the owner taps it. Scoped by business. */
export function markWaReminderSent(db: Db, businessId: string, reminderId: string, now: number): boolean {
  const res = db
    .update(reminders)
    .set({ status: "sent", sentAt: now })
    .where(
      and(
        eq(reminders.id, reminderId),
        eq(reminders.businessId, businessId),
        eq(reminders.channel, "wa_link"),
        eq(reminders.status, "ready"),
      ),
    )
    .run();
  return res.changes === 1;
}
