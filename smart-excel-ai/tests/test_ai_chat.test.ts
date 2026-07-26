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

test('remote AI requests carry workbook profile and financial report, and answers are surfaced', async () => {
  const workbook = await parseFixture('sample_transactions.csv');
  const originalFetch = globalThis.fetch;
  let capturedBody: any = null;

  globalThis.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ answer: 'Net cashflow is -9,980 driven by the Equipment purchase.', cached: false })
    };
  }) as typeof fetch;

  try {
    const response = await askWorkbookAi('What is my net cashflow?', workbook, []);

    assert.equal(capturedBody.question, 'What is my net cashflow?');
    assert.ok(capturedBody.workbookProfile, 'expected workbookProfile in the request');
    assert.ok(capturedBody.financialReport, 'expected financialReport in the request');
    assert.equal(capturedBody.financialReport.net, -9980);
    assert.equal(response.text, 'Net cashflow is -9,980 driven by the Equipment purchase.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
