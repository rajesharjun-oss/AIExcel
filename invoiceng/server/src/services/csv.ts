/**
 * Minimal CSV writer with two safety properties:
 * 1. RFC 4180 quoting (quotes, commas, newlines).
 * 2. Spreadsheet formula-injection guard: cells starting with = + - @ or a
 *    tab are prefixed with a single quote so Excel/Sheets treat them as text.
 */

export type CsvValue = string | number | null | undefined;

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value) : value;
  const first = s.charAt(0);
  if (typeof value === "string" && FORMULA_TRIGGERS.has(first)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [header.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  // Trailing newline plus UTF-8 BOM so Excel opens naira text correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Kobo -> "12345.50" (plain decimal, no symbol — spreadsheet friendly). */
export function koboToDecimalString(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(kobo);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}
