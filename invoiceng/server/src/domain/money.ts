/**
 * Money is always integer kobo (₦1 = 100 kobo). No floats anywhere.
 * VAT rate is 7.5% (Nigeria Tax Act 2025 kept the rate).
 */

export const VAT_RATE_BP = 750; // basis points (7.5%)
const BP_DENOMINATOR = 10_000;

/** Maximum we accept for any single amount: ₦10bn in kobo — far below MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_KOBO = 1_000_000_000_000;

export class MoneyError extends Error {
  override name = "MoneyError";
}

export function assertValidAmountKobo(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of kobo`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} may not be negative`);
  }
  if (value > MAX_AMOUNT_KOBO) {
    throw new MoneyError(`${label} exceeds the maximum supported amount`);
  }
}

/** Round-half-up VAT on an amount in kobo, using integer math only. */
export function vatOnKobo(amountKobo: number): number {
  assertValidAmountKobo(amountKobo, "amount");
  return Math.floor((amountKobo * VAT_RATE_BP + BP_DENOMINATOR / 2) / BP_DENOMINATOR);
}

export interface LineInput {
  readonly quantity: number;
  readonly unitPriceKobo: number;
}

export interface InvoiceTotals {
  readonly lineTotalsKobo: readonly number[];
  readonly subtotalKobo: number;
  readonly vatKobo: number;
  readonly totalKobo: number;
}

/**
 * Compute line totals, subtotal, VAT and grand total.
 * VAT is computed once on the subtotal (NRS practice for a single-rate invoice),
 * avoiding per-line rounding drift.
 */
export function computeInvoiceTotals(lines: readonly LineInput[], chargesVat: boolean): InvoiceTotals {
  if (lines.length === 0) {
    throw new MoneyError("an invoice needs at least one line item");
  }
  const lineTotalsKobo = lines.map((line, i) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1_000_000) {
      throw new MoneyError(`line ${i + 1}: quantity must be a whole number between 1 and 1,000,000`);
    }
    assertValidAmountKobo(line.unitPriceKobo, `line ${i + 1} unit price`);
    const total = line.quantity * line.unitPriceKobo;
    assertValidAmountKobo(total, `line ${i + 1} total`);
    return total;
  });
  const subtotalKobo = lineTotalsKobo.reduce((a, b) => a + b, 0);
  assertValidAmountKobo(subtotalKobo, "subtotal");
  const vatKobo = chargesVat ? vatOnKobo(subtotalKobo) : 0;
  const totalKobo = subtotalKobo + vatKobo;
  assertValidAmountKobo(totalKobo, "total");
  return { lineTotalsKobo, subtotalKobo, vatKobo, totalKobo };
}

/** Format kobo as a naira string, e.g. 1234550 -> "₦12,345.50". */
export function formatNaira(amountKobo: number): string {
  assertValidAmountKobo(amountKobo, "amount");
  const naira = Math.floor(amountKobo / 100);
  const kobo = amountKobo % 100;
  const nairaStr = naira.toLocaleString("en-NG");
  return kobo === 0 ? `₦${nairaStr}` : `₦${nairaStr}.${kobo.toString().padStart(2, "0")}`;
}
