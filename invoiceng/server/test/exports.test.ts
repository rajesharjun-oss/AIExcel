import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { koboToDecimalString, toCsv } from "../src/services/csv.js";
import { buildTestApp, createCustomer, createInvoice, signup, type TestContext } from "./helpers.js";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv(["a", "b"], [['he said "hi"', "x,y"], ["line\nbreak", "plain"]]);
    expect(csv).toContain('"he said ""hi"""');
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"line\nbreak"');
  });

  it("neutralises spreadsheet formula injection", () => {
    const csv = toCsv(["v"], [["=cmd|'/c calc'!A0"], ["+SUM(A1)"], ["@x"], ["-2+3"]]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+SUM");
    expect(csv).toContain("'@x");
    expect(csv).toContain("'-2+3");
  });

  it("does not mangle numbers or empty values", () => {
    const csv = toCsv(["n", "e"], [[-5, null]]);
    expect(csv).toContain("-5,");
  });
});

describe("koboToDecimalString", () => {
  it("renders kobo as plain decimals", () => {
    expect(koboToDecimalString(1_234_550)).toBe("12345.50");
    expect(koboToDecimalString(100)).toBe("1.00");
    expect(koboToDecimalString(0)).toBe("0.00");
  });
});

describe("export endpoints", () => {
  let ctx: TestContext;
  let cookie: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    ({ cookie } = await signup(ctx.app));
    const customerId = await createCustomer(ctx.app, cookie, { name: "=EvilCorp" });
    await createInvoice(ctx.app, cookie, customerId);
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/export/invoices.csv" });
    expect(res.statusCode).toBe(401);
  });

  it("exports invoices with naira decimals and injection-safe names", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/export/invoices.csv",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("INV-000001");
    expect(res.body).toContain("107500.00"); // ₦100,000 + VAT
    expect(res.body).toContain("'=EvilCorp"); // formula guard applied
  });

  it("only exports the caller's own data", async () => {
    const other = await signup(ctx.app, { phone: "08011114444", businessName: "Other Biz" });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/export/invoices.csv",
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("INV-000001");
  });

  it("exports customers and payments", async () => {
    const customersCsv = await ctx.app.inject({
      method: "GET",
      url: "/api/export/customers.csv",
      headers: { cookie },
    });
    expect(customersCsv.statusCode).toBe(200);
    expect(customersCsv.body).toContain("+2348052223344");

    const paymentsCsv = await ctx.app.inject({
      method: "GET",
      url: "/api/export/payments.csv",
      headers: { cookie },
    });
    expect(paymentsCsv.statusCode).toBe(200);
    expect(paymentsCsv.body).toContain("invoice,customer,amount_naira");
  });
});

describe("invoice PDF", () => {
  let ctx: TestContext;
  let cookie: string;
  let invoiceId: string;
  let shareToken: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    ({ cookie } = await signup(ctx.app));
    const customerId = await createCustomer(ctx.app, cookie);
    const inv = await createInvoice(ctx.app, cookie, customerId);
    invoiceId = inv.id;
    shareToken = inv.shareToken;
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("returns a real PDF for the owner", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/invoices/${invoiceId}/pdf`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  });

  it("blocks other businesses from the owner PDF (IDOR)", async () => {
    const attacker = await signup(ctx.app, { phone: "08011115555", businessName: "Mallory Ltd" });
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/invoices/${invoiceId}/pdf`,
      headers: { cookie: attacker.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("hides the public PDF for drafts, serves it once sent", async () => {
    const draft = await ctx.app.inject({ method: "GET", url: `/api/pub/invoices/${shareToken}/pdf` });
    expect(draft.statusCode).toBe(404);

    await ctx.app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/send`, headers: { cookie } });
    const sent = await ctx.app.inject({ method: "GET", url: `/api/pub/invoices/${shareToken}/pdf` });
    expect(sent.statusCode).toBe(200);
    expect(sent.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
