import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { CellValue, WorkbookModel } from '../../src/types';
import { parseWorkbook } from '../../src/lib/workbook';

export const fixturePath = (...parts: string[]) => path.join(process.cwd(), 'tests', 'fixtures', ...parts);
export const expectedPath = (...parts: string[]) => path.join(process.cwd(), 'tests', 'expected', ...parts);

export const loadFixtureFile = async (name: string, type = 'text/csv') => {
  const bytes = await readFile(fixturePath(name));
  return new File([bytes], name, { type });
};

export const parseFixture = async (name: string): Promise<WorkbookModel> => {
  const file = await loadFixtureFile(name);
  return parseWorkbook(file as unknown as globalThis.File);
};

export const workbookFromRows = async (
  rows: CellValue[][],
  fileName = 'generated.xlsx',
  sheetName = 'Data'
): Promise<WorkbookModel> => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const file = new File([Buffer.from(bytes)], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  return parseWorkbook(file as unknown as globalThis.File);
};

export const workbookFromSheets = async (
  sheets: Record<string, CellValue[][]>,
  fileName = 'generated.xlsx'
): Promise<WorkbookModel> => {
  const book = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  });
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const file = new File([Buffer.from(bytes)], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  return parseWorkbook(file as unknown as globalThis.File);
};

export const sheetRows = (workbook: WorkbookModel, index = 0) => workbook.sheets[index]?.rows ?? [];
