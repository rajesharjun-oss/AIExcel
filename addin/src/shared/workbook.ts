import type { WorkbookContext, WorkbookProfile, WorkbookSheetContext } from "@aiexcel/shared";

export async function getWorkbookContext(): Promise<WorkbookContext> {
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = ctx.workbook.getSelectedRange();
    sheet.load("name");
    range.load(["address", "values"]);
    await ctx.sync();

    return {
      activeSheet: sheet.name,
      selection: {
        address: range.address,
        values: range.values as unknown[][],
      },
    };
  });
}

export async function getWorkbookWideContext(maxRowsPerSheet = 500): Promise<WorkbookContext> {
  return Excel.run(async (ctx) => {
    const activeSheet = ctx.workbook.worksheets.getActiveWorksheet();
    const selection = ctx.workbook.getSelectedRange();
    const worksheets = ctx.workbook.worksheets;

    activeSheet.load("name");
    selection.load(["address", "values"]);
    worksheets.load("items/name");
    await ctx.sync();

    const usedRanges = worksheets.items.map((worksheet) => {
      const used = worksheet.getUsedRangeOrNullObject();
      used.load(["address", "values", "formulas", "rowCount", "columnCount"]);
      return { worksheet, used };
    });

    await ctx.sync();

    const sheets: WorkbookSheetContext[] = usedRanges.map(({ worksheet, used }) => {
      if (used.isNullObject) {
        return {
          name: worksheet.name,
          headers: [],
          values: [],
          formulas: [],
          rowCount: 0,
          columnCount: 0,
        };
      }

      const values = (used.values as unknown[][]).slice(0, maxRowsPerSheet + 1);
      const formulas = (used.formulas as string[][]).slice(0, maxRowsPerSheet + 1);
      const headers = (values[0] ?? []).map((value, index) => {
        const text = cellText(value).trim();
        return text || `Column ${index + 1}`;
      });

      return {
        name: worksheet.name,
        address: used.address,
        headers,
        values: values.slice(1),
        formulas: formulas.slice(1),
        rowCount: used.rowCount,
        columnCount: used.columnCount,
        truncated: used.rowCount > maxRowsPerSheet + 1,
      };
    });

    return {
      activeSheet: activeSheet.name,
      selection: {
        address: selection.address,
        values: selection.values as unknown[][],
      },
      sheets,
      profile: buildWorkbookProfile(sheets),
    };
  });
}

export async function getRangeValues(address: string): Promise<unknown[][]> {
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const range = sheet.getRange(address);
    range.load("values");
    await ctx.sync();
    return range.values as unknown[][];
  });
}

export async function getSheetSnapshot(maxRows = 500): Promise<{
  name: string;
  headers: string[];
  values: unknown[][];
}> {
  return Excel.run(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRange();
    sheet.load("name");
    used.load("values");
    await ctx.sync();

    const allValues = used.values as unknown[][];
    const headers = (allValues[0] ?? []).map(String);
    const values = allValues.slice(1, maxRows + 1);
    return { name: sheet.name, headers, values };
  });
}

export async function cleanSelectedRange(): Promise<{ address: string; changedCells: number }> {
  return Excel.run(async (ctx) => {
    const range = ctx.workbook.getSelectedRange();
    range.load(["address", "values"]);
    await ctx.sync();

    let changedCells = 0;
    const cleaned = (range.values as unknown[][]).map((row) =>
      row.map((value) => {
        if (typeof value !== "string") return value;
        const next = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        if (next !== value) changedCells++;
        return next;
      })
    );

    if (changedCells > 0) {
      range.values = cleaned;
      await ctx.sync();
    }

    return { address: range.address, changedCells };
  });
}

function buildWorkbookProfile(sheets: WorkbookSheetContext[]): WorkbookProfile {
  const relationshipHints: WorkbookProfile["relationshipHints"] = [];

  for (let i = 0; i < sheets.length; i++) {
    for (let j = i + 1; j < sheets.length; j++) {
      for (const left of sheets[i].headers) {
        for (const right of sheets[j].headers) {
          const leftNorm = normalise(left);
          const rightNorm = normalise(right);
          const identifierLike = /(id|number|code|account|invoice|customer|employee|staff|reference)/.test(
            `${leftNorm} ${rightNorm}`
          );

          if (leftNorm && leftNorm === rightNorm) {
            relationshipHints.push({
              leftSheet: sheets[i].name,
              leftColumn: left,
              rightSheet: sheets[j].name,
              rightColumn: right,
              reason: "Matching column names",
            });
          } else if (identifierLike && (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm))) {
            relationshipHints.push({
              leftSheet: sheets[i].name,
              leftColumn: left,
              rightSheet: sheets[j].name,
              rightColumn: right,
              reason: "Possible shared identifier",
            });
          }
        }
      }
    }
  }

  return {
    sheetCount: sheets.length,
    totalRows: sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    totalColumns: sheets.reduce((sum, sheet) => sum + sheet.columnCount, 0),
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rowCount,
      columns: sheet.columnCount,
      headers: sheet.headers,
    })),
    relationshipHints: relationshipHints.slice(0, 40),
  };
}

function normalise(value: unknown): string {
  return cellText(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}
