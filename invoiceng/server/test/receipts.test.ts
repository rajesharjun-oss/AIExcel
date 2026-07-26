import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, createCustomer, createInvoice, signup, type TestContext } from "./helpers.js";

describe("payment receipts", () => {
  let ctx: TestContext;
  let cookie: string;
  let invoiceId: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    ({ cookie } = await signup(ctx.app));
    const customerId = await createCustomer(ctx.app, cookie);
    const inv = await createInvoice(ctx.app, cookie, customerId);
    invoiceId = inv.id;
    await ctx.app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { cookie } });
    await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${invoiceId}/payments`,
      headers: { cookie },
      payload: { amountKobo: 5_000_000, method: "transfer" },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${invoiceId}/payments`,
      headers: { cookie },
      payload: { amountKobo: 5_750_000, method: "cash" },
    });
  });
  afterEach(async () => {
    await ctx.close();
  });

  async function getPayments(): Promise<Array<{ id: string; amountKobo: number }>> {
    const res = await ctx.app.inject({ method: "GET", url: `/api/invoices/${invoiceId}`, headers: { cookie } });
    return (res.json() as { payments: Array<{ id: string; amountKobo: number }> }).payments;
  }

  it("lists payments on the invoice in order", async () => {
    const paymentsList = await getPayments();
    expect(paymentsList).toHaveLength(2);
    expect(paymentsList[0]?.amountKobo).toBe(5_000_000);
    expect(paymentsList[1]?.amountKobo).toBe(5_750_000);
  });

  it("serves a receipt PDF with a stable sequence number", async () => {
    const paymentsList = await getPayments();
    const second = paymentsList[1]!;
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/invoices/${invoiceId}/payments/${second.id}/receipt.pdf`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("RCT-000001-2.pdf");
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("404s for a payment that belongs to a different invoice", async () => {
    const otherCustomer = await createCustomer(ctx.app, cookie, { name: "Second Buyer", phone: "08067778888" });
    const otherInv = await createInvoice(ctx.app, cookie, otherCustomer);
    const paymentsList = await getPayments();
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/invoices/${otherInv.id}/payments/${paymentsList[0]!.id}/receipt.pdf`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("blocks other businesses from receipts (IDOR)", async () => {
    const attacker = await signup(ctx.app, { phone: "08011116666", businessName: "Mallory Ltd" });
    const paymentsList = await getPayments();
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/invoices/${invoiceId}/payments/${paymentsList[0]!.id}/receipt.pdf`,
      headers: { cookie: attacker.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
