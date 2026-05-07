import type { WorkbookContext } from "@aiexcel/shared";

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
