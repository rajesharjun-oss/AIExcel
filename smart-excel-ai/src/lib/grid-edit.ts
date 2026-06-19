import type { CellValue, SheetData, WorkbookModel } from '../types';

const cloneRows = (rows: CellValue[][]): CellValue[][] => rows.map((row) => [...row]);

const defaultHeader = (index: number) => `Column ${index + 1}`;

const ensureSheetSize = (sheet: SheetData, rowIndex: number, columnIndex: number): SheetData => {
  const rows = cloneRows(sheet.rows);
  const width = Math.max(sheet.columnCount, columnIndex + 1);

  while (rows.length <= rowIndex) rows.push([]);
  rows.forEach((row) => {
    while (row.length < width) row.push(null);
  });

  const headers = Array.from({ length: width }, (_, index) => sheet.headers[index] || defaultHeader(index));

  return {
    ...sheet,
    rows,
    headers,
    columnCount: width,
    rowCount: Math.max(0, rows.length - sheet.dataStartIndex)
  };
};

const updateSheet = (workbook: WorkbookModel, sheetName: string, updater: (sheet: SheetData) => SheetData): WorkbookModel => ({
  ...workbook,
  sheets: workbook.sheets.map((sheet) => (sheet.name === sheetName ? updater(sheet) : sheet))
});

export const updateCell = (
  workbook: WorkbookModel,
  sheetName: string,
  rowIndex: number,
  columnIndex: number,
  value: CellValue
): WorkbookModel =>
  updateSheet(workbook, sheetName, (sheet) => {
    const next = ensureSheetSize(sheet, rowIndex, columnIndex);
    next.rows[rowIndex][columnIndex] = value;
    if (rowIndex === next.headerRowIndex) {
      next.headers[columnIndex] = String(value || defaultHeader(columnIndex));
    }
    return next;
  });

export const parseClipboardTable = (text: string): string[][] =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => line.split('\t'));

export const pasteCells = (
  workbook: WorkbookModel,
  sheetName: string,
  startRowIndex: number,
  startColumnIndex: number,
  clipboardText: string
): WorkbookModel => {
  const pasted = parseClipboardTable(clipboardText);
  if (!pasted.length) return workbook;

  return updateSheet(workbook, sheetName, (sheet) => {
    const maxColumns = Math.max(...pasted.map((row) => row.length));
    const next = ensureSheetSize(sheet, startRowIndex + pasted.length - 1, startColumnIndex + maxColumns - 1);
    pasted.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => {
        const rowIndex = startRowIndex + rowOffset;
        const columnIndex = startColumnIndex + columnOffset;
        next.rows[rowIndex][columnIndex] = value;
        if (rowIndex === next.headerRowIndex) {
          next.headers[columnIndex] = value || defaultHeader(columnIndex);
        }
      });
    });
    return next;
  });
};
