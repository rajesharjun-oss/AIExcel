import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { occurrencesFor, runReminderTick, type ReminderContext } from "../src/services/reminders.js";
import type { WhatsAppSender } from "../src/services/whatsapp.js";
import { buildTestApp, createCustomer, createInvoice, signup, type TestContext } from "./helpers.js";

const DAY = 86_400_000;
const silentLog = { info: () => {}, warn: () => {} };

const waOff: WhatsAppSender = {
  mode: "off",
  sendReminderTemplate: async () => {
    throw new Error("wa off — must not be called");
  },
};

describe("occurrencesFor", () => {
  const settings = { daysBeforeDue: 2, everyNDaysAfterDue: 3, maxAfterDueCount: 2 };
  const due = Date.UTC(2026, 0, 20);

  it("produces a pre-due nudge and the post-due sequence", () => {
    expect(occurrencesFor(due, settings)).toEqual([
      { seq: 0, scheduledFor: due - 2 * DAY },
      { seq: 1, scheduledFor: due + 3 * DAY },
      { seq: 2, scheduledFor: due + 6 * DAY },
    ]);
  });

  it("omits the pre-due nudge when disabled", () => {
    const occ = occurrencesFor(due, { ...settings, daysBeforeDue: 0 });
    expect(occ.every((o) => o.seq > 0)).toBe(true);
  });

  it("caps the post-due sequence", () => {
    const occ = occurrencesFor(due, { ...settings, maxAfterDueCount: 0 });
    expect(occ).toEqual([{ seq: 0, scheduledFor: due - 2 * DAY }]);
  });
});

describe("reminder tick", () => {
  let ctx: TestContext;
  let cookie: string;
  let invoiceId: string;
  const dueDate = Date.UTC(2026, 0, 20);

  function reminderCtx(
    smsOutcome: "sent" | "skipped_dry_run" | Error = "skipped_dry_run",
    wa: WhatsAppSender = waOff,
  ): ReminderContext {
    return {
      db: ctx.handle.db,
      appBaseUrl: "http://localhost:5173",
      sms: {
        send: async () => {
          if (smsOutcome instanceof Error) throw smsOutcome;
          return smsOutcome;
        },
      },
      wa,
      log: silentLog,
    };
  }

  beforeEach(async () => {
    ctx = await buildTestApp();
    ({ cookie } = await signup(ctx.app));
    const customerId = await createCustomer(ctx.app, cookie);
    const inv = await createInvoice(ctx.app, cookie, customerId, { dueDate });
    invoiceId = inv.id;
    await ctx.app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { cookie } });
  });
  afterEach(async () => {
    await ctx.close();
  });

  async function history(): Promise<Array<{ seq: number; channel: string; status: string }>> {
    const res = await ctx.app.inject({ method: "GET", url: "/api/reminders/history", headers: { cookie } });
    return (res.json() as { reminders: Array<{ seq: number; channel: string; status: string }> }).reminders;
  }

  it("creates nothing before the first occurrence is due", async () => {
    await runReminderTick(reminderCtx(), dueDate - 5 * DAY);
    expect(await history()).toHaveLength(0);
  });

  it("materializes due occurrences once, idempotently across ticks", async () => {
    const now = dueDate + 3 * DAY + 1000; // seq 0 and seq 1 are both due
    await runReminderTick(reminderCtx(), now);
    await runReminderTick(reminderCtx(), now);
    const rows = await history();
    // 2 occurrences × 2 channels (sms + wa_link; customer has a phone)
    expect(rows).toHaveLength(4);
    const sms = rows.filter((r) => r.channel === "sms");
    expect(sms.every((r) => r.status === "skipped_dry_run")).toBe(true);
    const wa = rows.filter((r) => r.channel === "wa_link");
    expect(wa.every((r) => r.status === "ready")).toBe(true);
  });

  it("marks SMS sent in live mode and failed on provider error", async () => {
    await runReminderTick(reminderCtx("sent"), dueDate - 2 * DAY + 1000);
    let rows = (await history()).filter((r) => r.channel === "sms");
    expect(rows[0]?.status).toBe("sent");

    // Next occurrence fails.
    await runReminderTick(reminderCtx(new Error("provider down")), dueDate + 3 * DAY + 1000);
    rows = (await history()).filter((r) => r.channel === "sms");
    expect(rows.map((r) => r.status).sort()).toEqual(["failed", "sent"]);
  });

  it("stops reminding once the invoice is paid", async () => {
    await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${invoiceId}/payments`,
      headers: { cookie },
      payload: { amountKobo: 10_750_000, method: "transfer" },
    });
    await runReminderTick(reminderCtx(), dueDate + 10 * DAY);
    expect(await history()).toHaveLength(0);
  });

  it("exposes wa.me links in the outbox and marks them sent on tap", async () => {
    await runReminderTick(reminderCtx(), dueDate - 2 * DAY + 1000);
    const outboxRes = await ctx.app.inject({ method: "GET", url: "/api/reminders/outbox", headers: { cookie } });
    const outbox = (outboxRes.json() as { outbox: Array<{ id: string; waLink: string | null }> }).outbox;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.waLink).toMatch(/^https:\/\/wa\.me\/2348052223344\?text=/);

    const mark = await ctx.app.inject({
      method: "POST",
      url: `/api/reminders/${outbox[0]!.id}/mark-sent`,
      headers: { cookie },
    });
    expect(mark.statusCode).toBe(200);
    const after = await ctx.app.inject({ method: "GET", url: "/api/reminders/outbox", headers: { cookie } });
    expect((after.json() as { outbox: unknown[] }).outbox).toHaveLength(0);
  });

  it("uses automated WhatsApp instead of the outbox when the Cloud API is enabled", async () => {
    const calls: Array<{ to: string; params: object }> = [];
    const waLive: WhatsAppSender = {
      mode: "live",
      sendReminderTemplate: async (to, params) => {
        calls.push({ to, params });
        return "sent";
      },
    };
    await runReminderTick(reminderCtx("sent", waLive), dueDate - 2 * DAY + 1000);

    const rows = await history();
    expect(rows.some((r) => r.channel === "wa_auto" && r.status === "sent")).toBe(true);
    expect(rows.some((r) => r.channel === "wa_link")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe("+2348052223344");
    expect(calls[0]?.params).toMatchObject({ invoiceNumber: "INV-000001" });

    const outboxRes = await ctx.app.inject({ method: "GET", url: "/api/reminders/outbox", headers: { cookie } });
    expect((outboxRes.json() as { outbox: unknown[] }).outbox).toHaveLength(0);
  });

  it("marks wa_auto failed when the Cloud API errors", async () => {
    const waBroken: WhatsAppSender = {
      mode: "live",
      sendReminderTemplate: async () => {
        throw new Error("template rejected");
      },
    };
    await runReminderTick(reminderCtx("sent", waBroken), dueDate - 2 * DAY + 1000);
    const rows = await history();
    const wa = rows.find((r) => r.channel === "wa_auto");
    expect(wa?.status).toBe("failed");
  });

  it("does not let another business mark my reminder as sent", async () => {
    await runReminderTick(reminderCtx(), dueDate - 2 * DAY + 1000);
    const outboxRes = await ctx.app.inject({ method: "GET", url: "/api/reminders/outbox", headers: { cookie } });
    const outbox = (outboxRes.json() as { outbox: Array<{ id: string }> }).outbox;
    const attacker = await signup(ctx.app, { phone: "08011113333", businessName: "Mallory Ltd" });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/reminders/${outbox[0]!.id}/mark-sent`,
      headers: { cookie: attacker.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
