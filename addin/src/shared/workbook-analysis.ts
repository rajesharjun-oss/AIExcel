import type { AuditResult, AuditSeverity, WorkbookContext, WorkbookSheetContext } from "@aiexcel/shared";

let idCounter = 0;

function finding(severity: AuditSeverity, message: string, location?: string): AuditResult {
  idCounter += 1;
  return { id: `local-${Date.now()}-${idCounter}`, severity, message, location };
}

export function summarizeWorkbook(context: WorkbookContext): AuditResult[] {
  const profile = context.profile;
  if (!profile) return [finding("suggestion", "Workbook context is not available yet.")];

  const biggest = [...profile.sheets]
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 3)
    .map((sheet) => `${sheet.name}: ${sheet.rows} rows, ${sheet.columns} columns`)
    .join("; ");

  const findings = [
    finding(
      "suggestion",
      `Workbook has ${profile.sheetCount} sheet${profile.sheetCount === 1 ? "" : "s"}, ${profile.totalRows} used rows, and ${profile.totalColumns} used columns.`
    ),
  ];

  if (biggest) findings.push(finding("suggestion", `Largest sheets: ${biggest}`));

  if (profile.relationshipHints.length > 0) {
    const hints = profile.relationshipHints
      .slice(0, 5)
      .map((hint) => `${hint.leftSheet}.${hint.leftColumn} <-> ${hint.rightSheet}.${hint.rightColumn}`)
      .join("; ");
    findings.push(finding("suggestion", `Possible cross-sheet relationships: ${hints}`));
  }

  return findings;
}

export function findDuplicateRows(context: WorkbookContext): AuditResult[] {
  const seen = new Map<string, Array<{ sheet: string; rowNumber: number; preview: string }>>();

  for (const sheet of context.sheets ?? []) {
    sheet.values.forEach((row, index) => {
      const signature = rowSignature(row);
      if (signature.length < 4) return;
      const entries = seen.get(signature) ?? [];
      entries.push({
        sheet: sheet.name,
        rowNumber: index + 2,
        preview: rowPreview(sheet, row),
      });
      seen.set(signature, entries);
    });
  }

  const results: AuditResult[] = [];
  for (const [signature, entries] of seen.entries()) {
    if (entries.length < 2) continue;
    const sheets = [...new Set(entries.map((entry) => entry.sheet))];
    const locations = entries.map((entry) => `${entry.sheet}!${entry.rowNumber}`).join(", ");
    const severity: AuditSeverity = sheets.length > 1 ? "error" : "warning";
    results.push(
      finding(
        severity,
        `Duplicate row appears ${entries.length} times${sheets.length > 1 ? " across sheets" : ""}. ${signature.slice(0, 160)}`,
        locations
      )
    );
  }

  return results.slice(0, 100);
}

export function findWorkbookInconsistencies(context: WorkbookContext): AuditResult[] {
  const results: AuditResult[] = [];

  for (const sheet of context.sheets ?? []) {
    const headers = sheet.headers.map(normalise);
    const duplicateHeaders = [...new Set(headers.filter((header, index) => header && headers.indexOf(header) !== index))];
    if (duplicateHeaders.length > 0) {
      results.push(
        finding(
          "error",
          `${sheet.name} has duplicate column headers: ${duplicateHeaders.join(", ")}.`,
          sheet.name
        )
      );
    }

    sheet.headers.forEach((header, columnIndex) => {
      const values = sheet.values.map((row) => row[columnIndex]);
      const nonEmptyValues = values.filter((value) => normalise(value));
      const missingRatio = (values.length - nonEmptyValues.length) / Math.max(1, values.length);
      const typeCounts = countTypes(nonEmptyValues);
      const dominantTypeCount = Math.max(0, ...Object.values(typeCounts));
      const typeTotal = Object.values(typeCounts).reduce((sum, count) => sum + count, 0);

      if (values.length >= 5 && missingRatio >= 0.35) {
        results.push(
          finding(
            missingRatio >= 0.7 ? "error" : "warning",
            `${sheet.name}.${header} is blank in ${Math.round(missingRatio * 100)}% of data rows.`,
            `${sheet.name}!${columnLetter(columnIndex)}:${columnLetter(columnIndex)}`
          )
        );
      }

      if (typeTotal >= 5 && dominantTypeCount / typeTotal < 0.8) {
        results.push(
          finding(
            "warning",
            `${sheet.name}.${header} appears to contain mixed data types.`,
            `${sheet.name}!${columnLetter(columnIndex)}:${columnLetter(columnIndex)}`
          )
        );
      }
    });

    sheet.values.forEach((row, rowIndex) => {
      const filledCells = row.filter((cell) => normalise(cell)).length;
      if (filledCells > 0 && filledCells <= Math.max(1, Math.floor(Math.max(1, sheet.columnCount) * 0.2))) {
        results.push(
          finding(
            "suggestion",
            `${sheet.name} row ${rowIndex + 2} is sparse with only ${filledCells} filled cell${filledCells === 1 ? "" : "s"}.`,
            `${sheet.name}!${rowIndex + 2}`
          )
        );
      }
    });

    results.push(...findFormulaIssues(sheet));
  }

  return results.slice(0, 150);
}

export function searchWorkbook(context: WorkbookContext, query: string): AuditResult[] {
  const terms = query
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !["find", "show", "data", "sheet", "across", "where", "with", "the", "for", "all"].includes(term));

  if (terms.length === 0) return [finding("suggestion", "Enter a specific value, name, ID, amount, or keyword to search.")];

  const results: AuditResult[] = [];
  for (const sheet of context.sheets ?? []) {
    sheet.values.forEach((row, rowIndex) => {
      const haystack = row.map(normalise).join(" ");
      if (terms.every((term) => haystack.includes(term))) {
        results.push(
          finding(
            "suggestion",
            `Matched "${terms.join(" ")}" in ${sheet.name} row ${rowIndex + 2}: ${rowPreview(sheet, row)}`,
            `${sheet.name}!${rowIndex + 2}`
          )
        );
      }
    });
  }

  return results.slice(0, 100);
}

export function findCleaningOpportunities(context: WorkbookContext): AuditResult[] {
  const results: AuditResult[] = [];

  for (const sheet of context.sheets ?? []) {
    let whitespaceCells = 0;
    let numericTextCells = 0;

    for (const row of sheet.values) {
      for (const cell of row) {
        if (typeof cell !== "string") continue;
        const cleaned = cell.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        if (cleaned !== cell) whitespaceCells++;
        if (/^-?[\d,]+(\.\d+)?$/.test(cleaned)) numericTextCells++;
      }
    }

    if (whitespaceCells > 0) {
      results.push(finding("warning", `${sheet.name} has ${whitespaceCells} text cell${whitespaceCells === 1 ? "" : "s"} with extra spacing.`, sheet.name));
    }

    if (numericTextCells > 0) {
      results.push(finding("suggestion", `${sheet.name} has ${numericTextCells} numeric-looking text cell${numericTextCells === 1 ? "" : "s"}.`, sheet.name));
    }
  }

  return results.length ? results : [finding("suggestion", "No basic whitespace cleanup opportunities were found in the workbook snapshot.")];
}

export function formatFindingsForChat(findings: AuditResult[]): string {
  if (findings.length === 0) return "No findings.";
  return findings
    .slice(0, 12)
    .map((item, index) => `${index + 1}. [${item.severity}] ${item.location ? `${item.location}: ` : ""}${item.message}`)
    .join("\n");
}

function findFormulaIssues(sheet: WorkbookSheetContext): AuditResult[] {
  const results: AuditResult[] = [];
  const formulas = sheet.formulas ?? [];

  formulas.forEach((row, rowIndex) => {
    row.forEach((formula, columnIndex) => {
      const value = cellText(sheet.values[rowIndex]?.[columnIndex]);
      if (/^#(REF|DIV\/0|VALUE|NAME|N\/A|NUM|NULL)!/.test(value)) {
        results.push(finding("error", `${sheet.name} contains formula error ${value}.`, `${sheet.name}!${columnLetter(columnIndex)}${rowIndex + 2}`));
      }

      if (formula?.startsWith("=") && /[+\-*/]\s*\d{3,}/.test(formula)) {
        results.push(
          finding(
            "warning",
            `${sheet.name} has a formula with a hardcoded number: ${formula}`,
            `${sheet.name}!${columnLetter(columnIndex)}${rowIndex + 2}`
          )
        );
      }
    });
  });

  const columnCount = formulas[0]?.length ?? 0;
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const patterns = new Set<string>();
    formulas.forEach((row) => {
      const formula = row[columnIndex];
      if (formula?.startsWith("=")) patterns.add(formula.replace(/\d+/g, "N"));
    });

    if (patterns.size > 1) {
      results.push(
        finding(
          "warning",
          `${sheet.name} column ${columnLetter(columnIndex)} has inconsistent formula patterns.`,
          `${sheet.name}!${columnLetter(columnIndex)}:${columnLetter(columnIndex)}`
        )
      );
    }
  }

  return results;
}

function countTypes(values: unknown[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    const type = inferType(value);
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
}

function inferType(value: unknown): string {
  const text = cellText(value).trim();
  if (!text) return "empty";
  if (/^(true|false|yes|no)$/i.test(text)) return "boolean";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "email";
  if (/^-?[\d,]+(\.\d+)?$/.test(text)) return "number";
  if (!Number.isNaN(Date.parse(text)) && /[-/]/.test(text)) return "date";
  return "text";
}

function rowSignature(row: unknown[]): string {
  return row.map(normalise).filter(Boolean).join(" | ");
}

function rowPreview(sheet: WorkbookSheetContext, row: unknown[]): string {
  return sheet.headers
    .map((header, index) => `${header}: ${cellText(row[index])}`)
    .filter((part) => !part.endsWith(": "))
    .slice(0, 6)
    .join(" | ");
}

function normalise(value: unknown): string {
  return cellText(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
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
