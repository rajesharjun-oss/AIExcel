import PDFDocument from "pdfkit";

/**
 * Invoice PDF rendering.
 * Amounts use the "NGN" prefix because the naira sign (U+20A6) is missing
 * from the PDF standard fonts; a broken glyph on a customer document is
 * worse than the plainer prefix.
 */

export interface PdfInvoiceData {
  readonly businessName: string;
  readonly businessTin: string | null;
  readonly customerName: string;
  readonly number: string;
  readonly status: string;
  readonly issueDate: number;
  readonly dueDate: number;
  readonly items: ReadonlyArray<{
    readonly description: string;
    readonly quantity: number;
    readonly unitPriceKobo: number;
    readonly lineTotalKobo: number;
  }>;
  readonly subtotalKobo: number;
  readonly vatKobo: number;
  readonly totalKobo: number;
  readonly paidKobo: number;
  readonly notes: string | null;
  readonly payUrl: string | null;
}

function ngn(kobo: number): string {
  const naira = Math.floor(kobo / 100);
  const rem = kobo % 100;
  const base = `NGN ${naira.toLocaleString("en-NG")}`;
  return rem === 0 ? base : `${base}.${String(rem).padStart(2, "0")}`;
}

function dateStr(ms: number): string {
  return new Date(ms).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

const INK = "#1b1f1d";
const SOFT = "#55605b";
const BRAND = "#0b3d2e";
const LINE = "#dedcd4";
const M = 50; // page margin

export function renderInvoicePdf(data: PdfInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: `Invoice ${data.number}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - M * 2;

    // Header
    doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(20).text(data.businessName, M, M);
    if (data.businessTin) {
      doc.fillColor(SOFT).font("Helvetica").fontSize(9).text(`TIN: ${data.businessTin}`);
    }
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(`INVOICE ${data.number}`, M, M, { width: pageWidth, align: "right" });
    doc
      .fillColor(data.status === "paid" ? BRAND : SOFT)
      .fontSize(10)
      .text(data.status === "paid" ? "PAID" : data.status.toUpperCase().replace("_", " "), {
        width: pageWidth,
        align: "right",
      });

    doc.moveDown(2);
    const infoY = Math.max(doc.y, 120);
    doc.fillColor(SOFT).font("Helvetica").fontSize(9).text("BILLED TO", M, infoY);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(data.customerName);
    doc.fillColor(SOFT).font("Helvetica").fontSize(9).text("ISSUED", M + pageWidth / 2, infoY);
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(dateStr(data.issueDate), M + pageWidth / 2);
    doc.fillColor(SOFT).font("Helvetica").fontSize(9).text("DUE", M + pageWidth / 2, doc.y + 4);
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(dateStr(data.dueDate), M + pageWidth / 2);

    // Items table
    let y = doc.y + 24;
    const colQty = M + pageWidth - 200;
    const colUnit = M + pageWidth - 160;
    const colTotal = M + pageWidth - 80;

    doc.fillColor(SOFT).font("Helvetica-Bold").fontSize(9);
    doc.text("DESCRIPTION", M, y, { width: colQty - M - 8 });
    doc.text("QTY", colQty, y, { width: 36, align: "right" });
    doc.text("UNIT", colUnit, y, { width: 76, align: "right" });
    doc.text("AMOUNT", colTotal, y, { width: 80, align: "right" });
    y += 14;
    doc.moveTo(M, y).lineTo(M + pageWidth, y).strokeColor(LINE).stroke();
    y += 8;

    doc.font("Helvetica").fontSize(10).fillColor(INK);
    for (const item of data.items) {
      const descHeight = doc.heightOfString(item.description, { width: colQty - M - 8 });
      if (y + descHeight > doc.page.height - 160) {
        doc.addPage();
        y = M;
      }
      doc.text(item.description, M, y, { width: colQty - M - 8 });
      doc.text(String(item.quantity), colQty, y, { width: 36, align: "right" });
      doc.text(ngn(item.unitPriceKobo), colUnit, y, { width: 76, align: "right" });
      doc.text(ngn(item.lineTotalKobo), colTotal, y, { width: 80, align: "right" });
      y += Math.max(descHeight, 12) + 8;
    }
    doc.moveTo(M, y).lineTo(M + pageWidth, y).strokeColor(LINE).stroke();
    y += 10;

    // Totals
    const totals: Array<[string, string, boolean]> = [
      ["Subtotal", ngn(data.subtotalKobo), false],
      ["VAT (7.5%)", data.vatKobo > 0 ? ngn(data.vatKobo) : "Not charged", false],
      ["Total", ngn(data.totalKobo), true],
    ];
    if (data.paidKobo > 0) {
      totals.push(["Paid", ngn(data.paidKobo), false]);
      totals.push(["Balance due", ngn(data.totalKobo - data.paidKobo), true]);
    }
    for (const [label, value, bold] of totals) {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(bold ? 12 : 10)
        .fillColor(INK);
      doc.text(label, colQty - 60, y, { width: 130, align: "right" });
      doc.text(value, colTotal - 20, y, { width: 100, align: "right" });
      y += bold ? 18 : 15;
    }

    // Footer
    if (data.notes) {
      y += 10;
      doc.fillColor(SOFT).font("Helvetica-Bold").fontSize(9).text("NOTES", M, y);
      doc.fillColor(INK).font("Helvetica").fontSize(10).text(data.notes, { width: pageWidth });
      y = doc.y;
    }
    if (data.payUrl) {
      y += 16;
      doc
        .fillColor(BRAND)
        .font("Helvetica")
        .fontSize(10)
        .text(`Pay online: ${data.payUrl}`, M, y, { link: data.payUrl, width: pageWidth });
    }

    doc.end();
  });
}
