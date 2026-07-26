# InvoiceNG

Invoicing + debt recovery ("customers owing") for Nigerian SMEs, with FIRS
e-invoicing designed in as a pluggable provider for when an Access Point
Provider (APP) partnership exists.

**Status: MVP.** Core flows are implemented and tested; payment and SMS
providers run in `dry_run` mode until real keys are configured.

## What it does

- **Invoices in naira** — line items, sequential numbering (`INV-000001`),
  7.5% VAT (or VAT-exempt for small companies under the Nigeria Tax Act 2025),
  all money handled as integer kobo.
- **Customer share links** — every sent invoice gets an unguessable link
  (`/i/<token>`) the customer can open without an account, see the balance,
  and pay via Paystack.
- **Debt recovery** — an idempotent reminder engine schedules nudges before
  the due date and repeats after it (configurable cadence/cap):
  - **WhatsApp**: pre-built `wa.me` links in the owner's tap-to-send outbox
    (no Meta approval needed; Cloud API automation is a planned adapter).
  - **SMS**: Termii adapter, fully automated in `live` mode.
- **Payments** — manual (cash/transfer) recording plus a Paystack webhook
  (HMAC-SHA512 verified over the raw body, idempotent by event id **and**
  provider reference, overpayment clamped and logged).
- **E-invoicing ready** — `EInvoiceProvider` interface with a stub; when an
  NRS-accredited APP partnership lands, implement the interface and flip
  `EINVOICE_MODE`. Nothing else changes.

## Stack

- `server/` — Node 22, Fastify 5, Zod, Drizzle ORM on SQLite (better-sqlite3),
  argon2id sessions, pino logging. 46 Vitest tests.
- `web/` — React 19 + Vite PWA-style app, react-router 8, no UI framework,
  mobile-first from 320px.

## Run it

```bash
# API (port 3000)
cd server && npm install && npm run dev

# Web (port 5173, proxies /api to the server)
cd web && npm install && npm run dev
```

Tests and checks:

```bash
cd server && npm test && npm run typecheck
cd web && npm run typecheck && npm run build
```

## Configuration (server environment)

All config is validated at startup; the process refuses to boot on invalid
values. See `server/src/config.ts` for the full schema.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | |
| `DATABASE_PATH` | `data/invoiceng.db` | SQLite; WAL mode |
| `APP_BASE_URL` | `http://localhost:5173` | used in share/pay links |
| `CORS_ORIGINS` | `http://localhost:5173` | comma-separated allowlist, no wildcard |
| `COOKIE_SECURE` | `false` | **must** be `true` in production |
| `PAYSTACK_MODE` | `dry_run` | `off` \| `dry_run` \| `live` (needs `PAYSTACK_SECRET_KEY`) |
| `SMS_MODE` | `dry_run` | `off` \| `dry_run` \| `live` (needs `TERMII_API_KEY`, `TERMII_SENDER_ID`) |
| `EINVOICE_MODE` | `off` | `off` \| `stub` |
| `WHATSAPP_MODE` | `off` | `off` \| `dry_run` \| `live` (needs `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` + an approved `payment_reminder` template) |

## Security notes

- Sessions: opaque 32-byte tokens, stored SHA-256-hashed, `HttpOnly` +
  `SameSite=Strict` cookies; argon2id password hashing; login timing is
  independent of account existence.
- Tenancy: every query is scoped by `business_id` from the session — covered
  by IDOR tests.
- Webhooks: signature verified over raw bytes before parsing; idempotent.
- Rate limits: 300/min global, 10/min on auth, 20/min on public pay,
  120/min on webhooks.
- Known accepted risk: `npm audit` reports 4 moderate advisories inside
  `drizzle-kit`'s bundled esbuild — a dev-only CLI that never listens on a
  port in production.

## Deliberately deferred (not silently missing)

- Real drizzle-kit migration files (schema is idempotent DDL; switch before
  the first data-preserving schema change).
- WhatsApp Cloud API automation (needs Meta business verification — adapter
  slot exists).
- FIRS APP integration (needs a commercial APP agreement; interface exists).
- Multi-user businesses, invoice PDF export, receipts, CSV export, password
  reset (needs an SMS/OTP decision), Postgres/Turso migration for multi-node.
