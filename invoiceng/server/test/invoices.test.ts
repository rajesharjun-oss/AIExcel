import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, createCustomer, createInvoice, signup, type TestContext } from "./helpers.js";

describe("invoices and payments", () => {
  let ctx: TestContext;
  let cookie: string;
  let customerId: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    ({ cookie } = await signup(ctx.app));
    customerId = await createCustomer(ctx.app, cookie);
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("creates an invoice with correct totals and sequential numbering", async () => {
    const inv1 = await createInvoice(ctx.app, cookie, customerId);
    const inv2 = await createInvoice(ctx.app, cookie, customerId);
    expect(inv1.number).toBe("INV-000001");
    expect(inv2.number).toBe("INV-000002");
    // 2 × ₦50,000 = ₦100,000 + 7.5% VAT = ₦107,500
    expect(inv1.totalKobo).toBe(10_750_000);
  });

  it("skips VAT for VAT-exempt businesses", async () => {
    const b = await signup(ctx.app, { phone: "08087654321", chargesVat: false, businessName: "Exempt Ltd" });
    const cid = await createCustomer(ctx.app, b.cookie);
    const inv = await createInvoice(ctx.app, b.cookie, cid);
    expect(inv.totalKobo).toBe(10_000_000);
  });

  it("walks sent -> part_paid -> paid and rejects overpayment", async () => {
    const inv = await createInvoice(ctx.app, cookie, customerId);
    const send = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/send`,
      headers: { cookie },
    });
    expect(send.statusCode).toBe(200);

    const part = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/payments`,
      headers: { cookie },
      payload: { amountKobo: 5_000_000, method: "transfer" },
    });
    expect(part.statusCode).toBe(201);
    expect(part.json()).toMatchObject({ newStatus: "part_paid", newPaidKobo: 5_000_000 });

    const over = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/payments`,
      headers: { cookie },
      payload: { amountKobo: 6_000_000, method: "cash" },
    });
    expect(over.statusCode).toBe(409);

    const rest = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/payments`,
      headers: { cookie },
      payload: { amountKobo: 5_750_000, method: "cash" },
    });
    expect(rest.statusCode).toBe(201);
    expect(rest.json()).toMatchObject({ newStatus: "paid" });

    const again = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/payments`,
      headers: { cookie },
      payload: { amountKobo: 1, method: "cash" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("rejects payments on a draft invoice", async () => {
    const inv = await createInvoice(ctx.app, cookie, customerId);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/payments`,
      headers: { cookie },
      payload: { amountKobo: 100, method: "cash" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("voids a draft and then refuses to send it", async () => {
    const inv = await createInvoice(ctx.app, cookie, customerId);
    const voided = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/void`,
      headers: { cookie },
    });
    expect(voided.statusCode).toBe(200);
    const send = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/send`,
      headers: { cookie },
    });
    expect(send.statusCode).toBe(409);
  });

  it("blocks cross-tenant access to invoices and customers (IDOR)", async () => {
    const inv = await createInvoice(ctx.app, cookie, customerId);
    const attacker = await signup(ctx.app, { phone: "08011112222", businessName: "Attacker Ltd" });

    const read = await ctx.app.inject({
      method: "GET",
      url: `/api/invoices/${inv.id}`,
      headers: { cookie: attacker.cookie },
    });
    expect(read.statusCode).toBe(404);

    const pay = await ctx.app.inject({
      method: "POST",
      url: `/api/invoices/${inv.id}/payments`,
      headers: { cookie: attacker.cookie },
      payload: { amountKobo: 100, method: "cash" },
    });
    expect(pay.statusCode).toBe(404);

    const cust = await ctx.app.inject({
      method: "GET",
      url: `/api/customers/${customerId}`,
      headers: { cookie: attacker.cookie },
    });
    expect(cust.statusCode).toBe(404);

    const invoiceWithForeignCustomer = await ctx.app.inject({
      method: "POST",
      url: "/api/invoices",
      headers: { cookie: attacker.cookie },
      payload: {
        customerId,
        dueDate: Date.UTC(2026, 1, 1),
        items: [{ description: "x", quantity: 1, unitPriceKobo: 100 }],
      },
    });
    expect(invoiceWithForeignCustomer.statusCode).toBe(404);
  });

  it("serves the public share page without auth, hiding drafts", async () => {
    const inv = await createInvoice(ctx.app, cookie, customerId);
    const draft = await ctx.app.inject({ method: "GET", url: `/api/pub/invoices/${inv.shareToken}` });
    expect(draft.statusCode).toBe(404);

    await ctx.app.inject({ method: "POST", url: `/api/invoices/${inv.id}/send`, headers: { cookie } });
    const pub = await ctx.app.inject({ method: "GET", url: `/api/pub/invoices/${inv.shareToken}` });
    expect(pub.statusCode).toBe(200);
    const body = pub.json() as Record<string, unknown>;
    expect(body["number"]).toBe(inv.number);
    expect(body["id"]).toBeUndefined(); // internal id is not exposed
  });

  it("initializes a dry-run checkout from the share page", async () => {
    const inv = await createInvoice(ctx.app, cookie, customerId);
    await ctx.app.inject({ method: "POST", url: `/api/invoices/${inv.id}/send`, headers: { cookie } });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/pub/invoices/${inv.shareToken}/pay`,
      payload: { email: "buyer@example.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { authorizationUrl: string; reference: string };
    expect(body.authorizationUrl).toContain("/pay/dry-run/");
    expect(body.reference).toMatch(/^png_/);
  });
});
