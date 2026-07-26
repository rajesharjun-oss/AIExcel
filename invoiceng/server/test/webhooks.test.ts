import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, createCustomer, createInvoice, signup, type TestContext } from "./helpers.js";

function chargeEvent(overrides: {
  eventId?: string;
  reference?: string;
  amount: number;
  invoiceId: string;
  currency?: string;
  status?: string;
}): object {
  return {
    event: "charge.success",
    data: {
      id: overrides.eventId ?? "evt_1",
      reference: overrides.reference ?? "ref_1",
      amount: overrides.amount,
      currency: overrides.currency ?? "NGN",
      status: overrides.status ?? "success",
      metadata: { invoice_id: overrides.invoiceId },
    },
  };
}

describe("paystack webhook", () => {
  let ctx: TestContext;
  let cookie: string;
  let invoiceId: string;
  let totalKobo: number;

  beforeEach(async () => {
    ctx = await buildTestApp();
    ({ cookie } = await signup(ctx.app));
    const customerId = await createCustomer(ctx.app, cookie);
    const inv = await createInvoice(ctx.app, cookie, customerId);
    invoiceId = inv.id;
    totalKobo = inv.totalKobo;
    await ctx.app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { cookie } });
  });
  afterEach(async () => {
    await ctx.close();
  });

  async function post(payload: object, signature = "test-signature") {
    return ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/paystack",
      headers: { "content-type": "application/json", "x-paystack-signature": signature },
      payload: JSON.stringify(payload),
    });
  }

  async function invoiceState(): Promise<{ status: string; paidKobo: number }> {
    const res = await ctx.app.inject({ method: "GET", url: `/api/invoices/${invoiceId}`, headers: { cookie } });
    return res.json() as { status: string; paidKobo: number };
  }

  it("rejects a missing or bad signature", async () => {
    const bad = await post(chargeEvent({ amount: totalKobo, invoiceId }), "wrong");
    expect(bad.statusCode).toBe(401);
    const state = await invoiceState();
    expect(state.paidKobo).toBe(0);
  });

  it("records a successful charge and marks the invoice paid", async () => {
    const res = await post(chargeEvent({ amount: totalKobo, invoiceId }));
    expect(res.statusCode).toBe(200);
    const state = await invoiceState();
    expect(state.status).toBe("paid");
    expect(state.paidKobo).toBe(totalKobo);
  });

  it("is idempotent for duplicate event ids", async () => {
    await post(chargeEvent({ amount: 1_000_000, invoiceId, eventId: "evt_dup", reference: "ref_a" }));
    const replay = await post(
      chargeEvent({ amount: 1_000_000, invoiceId, eventId: "evt_dup", reference: "ref_a" }),
    );
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { duplicate?: boolean }).duplicate).toBe(true);
    const state = await invoiceState();
    expect(state.paidKobo).toBe(1_000_000);
  });

  it("is idempotent for duplicate references under different event ids", async () => {
    await post(chargeEvent({ amount: 1_000_000, invoiceId, eventId: "evt_a", reference: "ref_same" }));
    await post(chargeEvent({ amount: 1_000_000, invoiceId, eventId: "evt_b", reference: "ref_same" }));
    const state = await invoiceState();
    expect(state.paidKobo).toBe(1_000_000);
  });

  it("clamps overpayment to the outstanding balance", async () => {
    const res = await post(chargeEvent({ amount: totalKobo + 500_000, invoiceId }));
    expect(res.statusCode).toBe(200);
    const state = await invoiceState();
    expect(state.status).toBe("paid");
    expect(state.paidKobo).toBe(totalKobo);
  });

  it("ignores non-success and non-NGN events", async () => {
    await post(chargeEvent({ amount: totalKobo, invoiceId, status: "failed", eventId: "evt_f" }));
    await post(chargeEvent({ amount: totalKobo, invoiceId, currency: "USD", eventId: "evt_u" }));
    const state = await invoiceState();
    expect(state.paidKobo).toBe(0);
  });

  it("acknowledges unknown event shapes without failing", async () => {
    const res = await post({ event: "subscription.create", data: { foo: "bar" } });
    expect(res.statusCode).toBe(200);
  });
});
