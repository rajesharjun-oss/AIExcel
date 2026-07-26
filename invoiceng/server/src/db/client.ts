import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  readonly db: Db;
  readonly sqlite: Database.Database;
  close(): void;
}

/**
 * Open (and create if missing) the SQLite database and apply the schema.
 * Schema DDL is idempotent (CREATE TABLE IF NOT EXISTS) — adequate while the
 * product is pre-launch; switch to drizzle-kit migration files before the
 * first release that must preserve data across schema changes.
 */
export function openDb(databasePath: string): DbHandle {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  applySchema(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

function applySchema(sqlite: Database.Database): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tin TEXT,
  charges_vat INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_business_idx ON customers(business_id);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'NGN',
  issue_date INTEGER NOT NULL,
  due_date INTEGER NOT NULL,
  subtotal_kobo INTEGER NOT NULL,
  vat_kobo INTEGER NOT NULL,
  total_kobo INTEGER NOT NULL,
  paid_kobo INTEGER NOT NULL DEFAULT 0,
  share_token TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_business_number_unique ON invoices(business_id, number);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_share_token_unique ON invoices(share_token);
CREATE INDEX IF NOT EXISTS invoices_business_status_idx ON invoices(business_id, status);
CREATE INDEX IF NOT EXISTS invoices_business_due_idx ON invoices(business_id, due_date);
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_kobo INTEGER NOT NULL,
  line_total_kobo INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount_kobo INTEGER NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  paid_at INTEGER NOT NULL,
  recorded_by_user_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_unique ON payments(reference);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE TABLE IF NOT EXISTS reminder_settings (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  days_before_due INTEGER NOT NULL DEFAULT 2,
  every_n_days_after_due INTEGER NOT NULL DEFAULT 3,
  max_after_due_count INTEGER NOT NULL DEFAULT 4
);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  seq INTEGER NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  sent_at INTEGER,
  wa_link TEXT,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reminders_occurrence_unique ON reminders(invoice_id, seq, channel);
CREATE INDEX IF NOT EXISTS reminders_business_status_idx ON reminders(business_id, status);
CREATE TABLE IF NOT EXISTS invoice_counters (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  next_number INTEGER NOT NULL DEFAULT 1
);
`);
}
