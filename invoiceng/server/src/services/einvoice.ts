/**
 * FIRS/NRS e-invoicing provider boundary.
 *
 * Nigeria's Merchant Buyer Solution requires invoices to be validated through
 * an accredited Access Point Provider (APP) and stamped with an Invoice
 * Reference Number (IRN). Accreditation and APP API contracts are commercial
 * agreements — until one exists, the stub keeps the domain model honest
 * (every invoice can carry an IRN) without pretending to comply.
 *
 * When an APP partnership lands, implement this interface against their API
 * and switch EINVOICE_MODE. Nothing else in the codebase should change.
 */

export interface EInvoiceSubmission {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly businessTin: string;
  readonly customerName: string;
  readonly issueDate: number;
  readonly subtotalKobo: number;
  readonly vatKobo: number;
  readonly totalKobo: number;
}

export type EInvoiceResult =
  | { readonly ok: true; readonly irn: string }
  | { readonly ok: false; readonly reason: string };

export interface EInvoiceProvider {
  readonly mode: "off" | "stub";
  submit(invoice: EInvoiceSubmission): Promise<EInvoiceResult>;
}

export function createEInvoiceProvider(mode: "off" | "stub"): EInvoiceProvider {
  return {
    mode,
    async submit(invoice: EInvoiceSubmission): Promise<EInvoiceResult> {
      if (mode === "off") {
        return { ok: false, reason: "e-invoicing is not enabled" };
      }
      // Stub: deterministic fake IRN so integration points can be exercised in tests.
      return { ok: true, irn: `STUB-IRN-${invoice.invoiceNumber}` };
    },
  };
}
