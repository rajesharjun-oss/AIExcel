import assert from 'node:assert/strict';
import { askWorkbookAi } from '../src/lib/assistant';
import { findDuplicates, findInconsistencies } from '../src/lib/workbook';
import { parseFixture } from './helpers/workbook-fixtures';
import { test } from './helpers/test-runner';

test('AI fallback answers duplicate questions using current workbook data', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const response = await askWorkbookAi('Summarize duplicates in this workbook', workbook, []);

  assert.equal(response.role, 'assistant');
  assert.match(response.text, /duplicate/i);
  assert.equal(response.findings?.length, findDuplicates(workbook).length);
  assert.doesNotMatch(response.text, /made-up|imaginary/i);
});

test('AI fallback summarizes blanks, inconsistencies and totals without changing data', async () => {
  const workbook = await parseFixture('sample_dirty_data.csv');
  const before = JSON.stringify(workbook);
  const visibleFindings = findInconsistencies(workbook);
  const response = await askWorkbookAi('Find blanks, invalid numbers and inconsistencies', workbook, visibleFindings);

  assert.match(response.text, /inconsistent|missing|mixed|invalid/i);
  assert.ok((response.findings?.length ?? 0) >= 1);
  assert.equal(JSON.stringify(workbook), before);
});
