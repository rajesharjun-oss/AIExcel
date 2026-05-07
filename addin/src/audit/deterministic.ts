import type { AuditResult, AuditSeverity } from "@aiexcel/shared";

let _idCounter = 0;
function makeId(prefix: string) {
  return `${prefix}-${++_idCounter}`;
}

function result(severity: AuditSeverity, message: string, location?: string): AuditResult {
  return { id: makeId("det"), severity, message, location };
}

export async function runDeterministicAudit(): Promise<AuditResult[]> {
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRange();
    sheet.load("name");
    used.load(["address", "values", "formulas", "numberFormat"]);
    await ctx.sync();

    const findings: AuditResult[] = [];
    const values = used.values as unknown[][];
    const formulas = used.formulas as string[][];

    for (let r = 0; r < formulas.length; r++) {
      for (let c = 0; c < formulas[r].length; c++) {
        const val = String(values[r]?.[c] ?? "");
        const formula = formulas[r][c];
        const cellAddr = cellAddress(used.address, r, c);

        // Broken formula errors
        if (/^#(REF|DIV\/0|VALUE|NAME|N\/A|NUM|NULL)!/.test(val)) {
          findings.push(result("error", `Cell contains ${val}`, cellAddr));
        }

        // Hardcoded number inside a formula (e.g. =A1+500)
        if (formula.startsWith("=") && /[+\-*/]\s*\d{3,}/.test(formula)) {
          findings.push(
            result("warning", `Hardcoded number in formula: ${formula}`, cellAddr)
          );
        }
      }
    }

    // Inconsistent formulas in a column (all non-empty cells should share same formula pattern)
    const colCount = formulas[0]?.length ?? 0;
    for (let c = 0; c < colCount; c++) {
      const patterns = new Set<string>();
      for (let r = 1; r < formulas.length; r++) {
        const f = formulas[r][c];
        if (f?.startsWith("=")) patterns.add(normaliseFormula(f));
      }
      if (patterns.size > 1) {
        const colLetter = columnLetter(c);
        findings.push(
          result(
            "warning",
            `Column ${colLetter} has inconsistent formulas (${patterns.size} different patterns)`,
            `${colLetter}:${colLetter}`
          )
        );
      }
    }

    // Duplicate values in first column (likely a key column)
    const firstColValues = values.slice(1).map((r) => String(r[0] ?? "")).filter(Boolean);
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const v of firstColValues) {
      if (seen.has(v)) dupes.add(v);
      seen.add(v);
    }
    if (dupes.size > 0) {
      findings.push(
        result(
          "warning",
          `Duplicate values in column A: ${[...dupes].slice(0, 5).join(", ")}${dupes.size > 5 ? "…" : ""}`,
          "A:A"
        )
      );
    }

    return findings;
  });
}

function normaliseFormula(formula: string): string {
  // Strip row numbers so =SUM(A2:A10) and =SUM(A3:A11) share a pattern
  return formula.replace(/\d+/g, "N");
}

function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function cellAddress(rangeAddress: string, row: number, col: number): string {
  // rangeAddress is like "Sheet1!A1:Z100" — extract top-left origin
  const match = rangeAddress.match(/!?([A-Z]+)(\d+)/);
  if (!match) return `R${row + 1}C${col + 1}`;
  const originCol = match[1].charCodeAt(0) - 65;
  const originRow = parseInt(match[2], 10) - 1;
  return `${columnLetter(originCol + col)}${originRow + row + 1}`;
}
