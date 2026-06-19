import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pasteCells, updateCell } from '../src/lib/grid-edit';
import { buildWorkbookProfile, searchWorkbook } from '../src/lib/workbook';
import { parseFixture, workbookFromRows } from './helpers/workbook-fixtures';
import { test } from './helpers/test-runner';

test('uploaded workbook data opens as an indexed spreadsheet model', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const sheet = workbook.sheets[0];
  const profile = buildWorkbookProfile(workbook);

  assert.equal(workbook.fileName, 'sample_dirty_data.csv');
  assert.equal(profile.sheetCount, 1);
  assert.equal(sheet.headers.slice(0, 4).join('|'), 'Date|Description|Name|Amount');
  assert.equal(sheet.rowCount, 7);
  assert.equal(sheet.columnCount, 6);
  assert.equal(sheet.rows[sheet.dataStartIndex][1], '  FIRS payment  ');
});

test('workbook model supports columns beyond AZ', async () => {
  const headers = Array.from({ length: 60 }, (_, index) => `Column ${index + 1}`);
  const row = Array.from({ length: 60 }, (_, index) => `value-${index + 1}`);
  const workbook = await workbookFromRows([headers, row], 'wide.xlsx');
  const sheet = workbook.sheets[0];

  assert.equal(sheet.columnCount, 60);
  assert.equal(sheet.headers[51], 'Column 52');
  assert.equal(sheet.headers[59], 'Column 60');
  assert.equal(sheet.rows[sheet.dataStartIndex][59], 'value-60');
});

test('large workbook indexing and searching stay practical', async () => {
  const rows = [['Date', 'Description', 'Amount']];
  for (let index = 0; index < 2500; index += 1) {
    rows.push(['2026-02-01', index === 2499 ? 'needle payment' : `ordinary payment ${index}`, String(index + 1)]);
  }

  const started = performance.now();
  const workbook = await workbookFromRows(rows, 'large.xlsx');
  const matches = searchWorkbook(workbook, 'needle');
  const elapsed = performance.now() - started;

  assert.equal(workbook.sheets[0].rowCount, 2500);
  assert.equal(matches.length, 1);
  assert.ok(elapsed < 2000, `large workbook parse/search took ${elapsed}ms`);
});

test('users can enter values into cells without mutating the previous workbook object', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const sheet = workbook.sheets[0];
  const edited = updateCell(workbook, sheet.name, sheet.dataStartIndex, 1, 'Edited description');

  assert.equal(workbook.sheets[0].rows[sheet.dataStartIndex][1], '  FIRS payment  ');
  assert.equal(edited.sheets[0].rows[sheet.dataStartIndex][1], 'Edited description');
});

test('pasting multiple rows and columns writes a rectangular range', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const sheet = workbook.sheets[0];
  const pasted = pasteCells(workbook, sheet.name, sheet.dataStartIndex + 1, 1, 'Alpha\t10\nBeta\t20');

  assert.equal(pasted.sheets[0].rows[sheet.dataStartIndex + 1][1], 'Alpha');
  assert.equal(pasted.sheets[0].rows[sheet.dataStartIndex + 1][2], '10');
  assert.equal(pasted.sheets[0].rows[sheet.dataStartIndex + 2][1], 'Beta');
  assert.equal(pasted.sheets[0].rows[sheet.dataStartIndex + 2][2], '20');
});

test('paste expands rows and columns when data exceeds current sheet size', async () => {
  const workbook = await workbookFromRows(
    [
      ['A', 'B'],
      ['one', 'two']
    ],
    'small.xlsx'
  );
  const sheet = workbook.sheets[0];
  const pasted = pasteCells(workbook, sheet.name, sheet.dataStartIndex + 2, 3, 'wide');

  assert.equal(pasted.sheets[0].columnCount, 4);
  assert.equal(pasted.sheets[0].rowCount, 3);
  assert.equal(pasted.sheets[0].headers[3], 'Column 4');
  assert.equal(pasted.sheets[0].rows[sheet.dataStartIndex + 2][3], 'wide');
});

test('editing a header cell updates the detected header label', async () => {
  const workbook = await workbookFromRows(
    [
      ['Old Header'],
      ['value']
    ],
    'headers.xlsx'
  );
  const sheet = workbook.sheets[0];
  const edited = updateCell(workbook, sheet.name, sheet.headerRowIndex, 0, 'New Header');

  assert.equal(edited.sheets[0].headers[0], 'New Header');
});
