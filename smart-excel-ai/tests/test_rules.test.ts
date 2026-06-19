import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyRulesToSheet, resultRowsByCategory } from '../src/lib/rules';
import { expectedPath, parseFixture } from './helpers/workbook-fixtures';
import { test } from './helpers/test-runner';

test('rule engine categorizes tax and bank-charge rows while preserving totals', async () => {
  const workbook = await parseFixture('sample_rules.csv');
  const result = applyRulesToSheet(workbook.sheets[0]);
  const expected = JSON.parse(await readFile(expectedPath('expected_rule_results.json'), 'utf8'));

  assert.equal(result.totalRows, expected.totalRows);
  assert.equal(result.categorizedRows, expected.categorizedRows);
  assert.equal(result.uncategorizedRows, expected.uncategorizedRows);
  assert.equal(result.invalidAmountRows, expected.invalidAmountRows);
  assert.equal(result.totalBefore, expected.totalBefore);
  assert.equal(result.totalAfter, expected.totalAfter);
  assert.equal(resultRowsByCategory(result, 'FIRS').length, expected.categories.FIRS);
  assert.equal(resultRowsByCategory(result, 'SIRS').length, expected.categories.SIRS);
  assert.equal(resultRowsByCategory(result, 'Bank Charges').length, expected.categories['Bank Charges']);
  assert.equal(resultRowsByCategory(result, 'Unallocated').length, expected.categories.Unallocated);
});

test('rule engine flags unmatched and invalid rows for review without changing amounts', async () => {
  const workbook = await parseFixture('sample_rules.csv');
  const result = applyRulesToSheet(workbook.sheets[0]);
  const invalidAmount = result.rows.find((row) => row.values.Description === 'Invalid amount');
  const blankAmount = result.rows.find((row) => row.values.Description === 'Blank amount');
  const unknownVendor = result.rows.find((row) => row.values.Description === 'Unknown vendor');

  assert.ok(invalidAmount?.reviewFlags.includes('invalid_amount'));
  assert.ok(blankAmount?.reviewFlags.includes('blank_amount'));
  assert.ok(unknownVendor?.reviewFlags.includes('uncategorized'));
  assert.equal(unknownVendor?.amount, 500);
});
