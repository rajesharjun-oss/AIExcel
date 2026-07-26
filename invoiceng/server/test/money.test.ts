import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  formatNaira,
  MoneyError,
  vatOnKobo,
  MAX_AMOUNT_KOBO,
} from "../src/domain/money.js";

describe("vatOnKobo", () => {
  it("computes 7.5% with integer math", () => {
    expect(vatOnKobo(10_000)).toBe(750);
    expect(vatOnKobo(0)).toBe(0);
  });

  it("rounds half up", () => {
    // 7.5% of 10 kobo = 0.75 -> 1
    expect(vatOnKobo(10)).toBe(1);
    // 7.5% of 6 kobo = 0.45 -> 0
    expect(vatOnKobo(6)).toBe(0);
    // 7.5% of 60 kobo = 4.5 -> 5 (exact half)
    expect(vatOnKobo(60)).toBe(5);
  });

  it("rejects negatives, floats and unsafe integers", () => {
    expect(() => vatOnKobo(-1)).toThrow(MoneyError);
    expect(() => vatOnKobo(1.5)).toThrow(MoneyError);
    expect(() => vatOnKobo(MAX_AMOUNT_KOBO + 1)).toThrow(MoneyError);
  });
});

describe("computeInvoiceTotals", () => {
  it("computes line totals, subtotal, VAT and total", () => {
    const t = computeInvoiceTotals(
      [
        { quantity: 2, unitPriceKobo: 5_000_000 }, // ₦100,000
        { quantity: 1, unitPriceKobo: 250_000 }, // ₦2,500
      ],
      true,
    );
    expect(t.lineTotalsKobo).toEqual([10_000_000, 250_000]);
    expect(t.subtotalKobo).toBe(10_250_000);
    expect(t.vatKobo).toBe(768_750); // 7.5% of ₦102,500
    expect(t.totalKobo).toBe(11_018_750);
  });

  it("charges no VAT for VAT-exempt businesses", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unitPriceKobo: 10_000 }], false);
    expect(t.vatKobo).toBe(0);
    expect(t.totalKobo).toBe(10_000);
  });

  it("rejects an empty invoice", () => {
    expect(() => computeInvoiceTotals([], true)).toThrow(MoneyError);
  });

  it("rejects zero and fractional quantities", () => {
    expect(() => computeInvoiceTotals([{ quantity: 0, unitPriceKobo: 100 }], true)).toThrow(MoneyError);
    expect(() => computeInvoiceTotals([{ quantity: 1.5, unitPriceKobo: 100 }], true)).toThrow(MoneyError);
  });

  it("rejects totals that overflow the supported range", () => {
    expect(() =>
      computeInvoiceTotals([{ quantity: 1_000_000, unitPriceKobo: MAX_AMOUNT_KOBO }], true),
    ).toThrow(MoneyError);
  });
});

describe("formatNaira", () => {
  it("formats whole naira without kobo", () => {
    expect(formatNaira(1_000_000)).toBe("₦10,000");
  });
  it("formats kobo with two digits", () => {
    expect(formatNaira(1_234_550)).toBe("₦12,345.50");
    expect(formatNaira(5)).toBe("₦0.05");
  });
});
