import assert from 'node:assert/strict';
import { cleanRows, createCleaningFindings, findDuplicates, findInconsistencies } from '../src/lib/workbook';
import { parseFixture } from './helpers/workbook-fixtures';
import { test } from './helpers/test-runner';

test('cleaning trims spaces, standardizes dates, converts numeric text, and preserves other values', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const sheet = workbook.sheets[0];
  const cleaned = cleanRows(sheet);

  assert.equal(cleaned[1][0], '2026-02-01');
  assert.equal(cleaned[1][1], 'FIRS payment');
  assert.equal(cleaned[1][3], 1000);
  assert.equal(cleaned[6][5], 'preserve');
  assert.equal(cleaned[5][3], 'abc');
});

test('duplicate detection identifies repeated records without deleting rows', async () => {
  const workbook = await parseFixture('sample_duplicates.csv');
  const duplicates = findDuplicates(workbook);

  assert.equal(workbook.sheets[0].rowCount, 4);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].type, 'duplicate');
  assert.deepEqual(duplicates[0].rows, [2, 3]);
});

test('data quality checks detect blanks, invalid numbers and outlier amounts', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const findings = findInconsistencies(workbook);
  const titles = findings.map((finding) => finding.title);

  assert.ok(titles.includes('Blank required field'));
  assert.ok(titles.includes('Invalid number in amount column'));
  assert.ok(titles.includes('Unusual amount'));
});

test('cleaning findings report available changes', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const findings = createCleaningFindings(workbook);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'cleaning');
  assert.equal(findings[0].severity, 'medium');
});
