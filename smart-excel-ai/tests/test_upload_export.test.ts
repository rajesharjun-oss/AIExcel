import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { cleanWorkbookToArrayBuffer } from '../src/lib/workbook';
import { parseFixture, workbookFromRows } from './helpers/workbook-fixtures';
import { File } from 'node:buffer';
import { parseWorkbook } from '../src/lib/workbook';
import { test } from './helpers/test-runner';

test('CSV upload preserves headers, rows, numbers, dates and text as displayed data', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const sheet = workbook.sheets[0];

  assert.deepEqual(sheet.headers, ['Date', 'Description', 'Name', 'Amount', 'Required Ref', 'Notes']);
  assert.equal(sheet.rows[sheet.dataStartIndex + 3][3], '50000');
  assert.equal(sheet.rows[sheet.dataStartIndex + 4][3], 'abc');
  assert.equal(sheet.rows[sheet.dataStartIndex + 5][1], 'Normal service fee');
});

test('XLSX upload opens inside the workbook model with accurate cells', async () => {
  const workbook = await workbookFromRows(
    [
      ['Date', 'Description', 'Amount'],
      ['2026-02-01', 'FIRS payment', 1000],
      ['2026-02-02', 'LIRS payment', 2000]
    ],
    'sample_upload.xlsx'
  );

  const sheet = workbook.sheets[0];
  assert.equal(sheet.name, 'Data');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.rows[sheet.dataStartIndex + 1][1], 'LIRS payment');
  assert.equal(sheet.rows[sheet.dataStartIndex + 1][2], '2000');
});

test('cleaned export contains the same processed result the cleaner produces', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const buffer = cleanWorkbookToArrayBuffer(workbook);
  const file = new File([Buffer.from(buffer)], 'cleaned.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const exported = await parseWorkbook(file as unknown as globalThis.File);
  const exportedRows = exported.sheets[0].rows;

  assert.equal(exportedRows[1][0], '2026-02-01');
  assert.equal(exportedRows[1][1], 'FIRS payment');
  assert.equal(exportedRows[1][3], '1000');

  const rawBook = XLSX.read(buffer, { type: 'array' });
  assert.equal(rawBook.SheetNames[0], 'Sheet1');
});
