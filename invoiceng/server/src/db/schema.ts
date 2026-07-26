import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/** Epoch milliseconds. SQLite has no native datetime; integers keep math exact. */
const ms = (name: string) => integer(name);

export const businesses = sqliteTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Tax Identification Number; optional until the owner formalises. */
  tin: text("tin"),
  /** Small companies (≤ ₦100m turnover) may not charge VAT under NTA 2025. */
  chargesVat: integer("charges_vat", { mode: "boolean" }).notNull().default(true),
  createdAt: ms("created_at").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    /** E.164, e.g. +2348031234567. Login identifier. */
    phone: text("phone").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [uniqueIndex("users_phone_unique").on(t.phone)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 hex of the opaque token; the raw token is never stored. */
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: ms("expires_at").notNull(),
    createdAt: ms("created_at").notNull(),
    revokedAt: ms("revoked_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("customers_business_idx").on(t.businessId)],
);

export const INVOICE_STATUSES = ["draft", "sent", "part_paid", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    /** Sequential per business, e.g. INV-000042. */
    number: text("number").notNull(),
    status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
    currency: text("currency").notNull().default("NGN"),
    issueDate: ms("issue_date").notNull(),
    dueDate: ms("due_date").notNull(),
    subtotalKobo: integer("subtotal_kobo").notNull(),
    vatKobo: integer("vat_kobo").notNull(),
    totalKobo: integer("total_kobo").notNull(),
    paidKobo: integer("paid_kobo").notNull().default(0),
    /** Unguessable token for the customer-facing share/pay page. */
    shareToken: text("share_token").notNull(),
    notes: text("notes"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("invoices_business_number_unique").on(t.businessId, t.number),
    uniqueIndex("invoices_share_token_unique").on(t.shareToken),
    index("invoices_business_status_idx").on(t.businessId, t.status),
    index("invoices_business_due_idx").on(t.businessId, t.dueDate),
  ],
);

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceKobo: integer("unit_price_kobo").notNull(),
    lineTotalKobo: integer("line_total_kobo").notNull(),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

export const PAYMENT_METHODS = ["cash", "transfer", "paystack"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amountKobo: integer("amount_kobo").notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    /** Provider reference (e.g. Paystack reference). Unique when present. */
    reference: text("reference"),
    paidAt: ms("paid_at").notNull(),
    /** Null when recorded by a webhook rather than a person. */
    recordedByUserId: text("recorded_by_user_id").references(() => users.id),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("payments_reference_unique").on(t.reference),
    index("payments_invoice_idx").on(t.invoiceId),
  ],
);

/** Processed provider webhook events; primary key enforces idempotency. */
export const webhookEvents = sqliteTable("webhook_events", {
  /** `${provider}:${eventId}` */
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  receivedAt: ms("received_at").notNull(),
  processedAt: ms("processed_at"),
});

export const reminderSettings = sqliteTable("reminder_settings", {
  businessId: text("business_id")
    .primaryKey()
    .references(() => businesses.id),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Send a nudge this many days before the due date (0 disables). */
  daysBeforeDue: integer("days_before_due").notNull().default(2),
  /** After due, repeat every N days. */
  everyNDaysAfterDue: integer("every_n_days_after_due").notNull().default(3),
  /** Stop after this many post-due reminders. */
  maxAfterDueCount: integer("max_after_due_count").notNull().default(4),
});

export const REMINDER_CHANNELS = ["wa_link", "wa_auto", "sms"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_STATUSES = ["ready", "sent", "skipped_dry_run", "failed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    /** 0 = pre-due nudge; 1..N = post-due sequence. */
    seq: integer("seq").notNull(),
    channel: text("channel").$type<ReminderChannel>().notNull(),
    status: text("status").$type<ReminderStatus>().notNull(),
    scheduledFor: ms("scheduled_for").notNull(),
    sentAt: ms("sent_at"),
    /** Pre-built wa.me deep link for the owner to tap (wa_link channel). */
    waLink: text("wa_link"),
    /** Message body actually rendered for this occurrence. */
    message: text("message").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("reminders_occurrence_unique").on(t.invoiceId, t.seq, t.channel),
    index("reminders_business_status_idx").on(t.businessId, t.status),
  ],
);

export const invoiceCounters = sqliteTable("invoice_counters", {
  businessId: text("business_id")
    .primaryKey()
    .references(() => businesses.id),
  nextNumber: integer("next_number").notNull().default(1),
});
