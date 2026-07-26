import assert from 'node:assert/strict';
import { askWorkbookAi } from '../src/lib/assistant';
import { analyzeSheetFinances, analyzeWorkbookFinances, detectFinancialColumns } from '../src/lib/finance';
import { parseFixture, workbookFromRows } from './helpers/workbook-fixtures';
import { test } from './helpers/test-runner';

test('financial column detection finds date, amount, category and description columns', async () => {
  const workbook = await parseFixture('sample_transactions.csv');
  const columns = detectFinancialColumns(workbook.sheets[0]);

  assert.equal(columns.dateIndex, 0);
  assert.equal(columns.descriptionIndex, 1);
  assert.equal(columns.categoryIndex, 2);
  assert.equal(columns.amountIndex, 3);
});

test('cashflow analysis computes inflow, outflow, net and largest movements', async () => {
  const workbook = await parseFixture('sample_transactions.csv');
  const report = analyzeSheetFinances(workbook.sheets[0]);

  assert.ok(report, 'expected a financial report');
  assert.equal(report!.transactionCount, 12);
  assert.equal(report!.totalInflow, 15300);
  assert.equal(report!.totalOutflow, 25280);
  assert.equal(report!.net, -9980);
  assert.equal(report!.largestInflow?.amount, 5000);
  assert.equal(report!.largestOutflow?.amount, -20000);
  assert.equal(report!.largestOutflow?.rowNumber, 9);
});

test('category breakdown is grouped and ranked by absolute value', async () => {
  const workbook = await parseFixture('sample_transactions.csv');
  const report = analyzeSheetFinances(workbook.sheets[0])!;

  assert.equal(report.groupedBy, 'Category');
  assert.equal(report.categories[0].label, 'Equipment');
  assert.equal(report.categories[0].total, -20000);
  const salary = report.categories.find((category) => category.label === 'Salary');
  assert.equal(salary?.total, 15000);
  assert.equal(salary?.count, 3);
});

test('monthly trend buckets transactions by calendar month', async () => {
  const workbook = await parseFixture('sample_transactions.csv');
  const report = analyzeSheetFinances(workbook.sheets[0])!;

  assert.equal(report.monthly.length, 3);
  assert.deepEqual(report.monthly.map((month) => month.month), ['2026-01', '2026-02', '2026-03']);
  const february = report.monthly[1];
  assert.equal(february.inflow, 5000);
  assert.equal(february.outflow, 21750);
  assert.equal(february.net, -16750);
});

test('anomaly detection flags amounts outside the typical range', async () => {
  const workbook = await parseFixture('sample_transactions.csv');
  const report = analyzeSheetFinances(workbook.sheets[0])!;

  assert.equal(report.anomalies.length, 1);
  assert.equal(report.anomalies[0].amount, -20000);
  assert.equal(report.anomalies[0].rowNumber, 9);
});

test('separate debit and credit columns net to a signed amount', async () => {
  const workbook = await workbookFromRows([
    ['Date', 'Narration', 'Debit', 'Credit'],
    ['2026-01-04', 'Opening deposit', '', '1000'],
    ['2026-01-06', 'Supplier payment', '400', ''],
    ['2026-01-09', 'Refund received', '', '250']
  ]);
  const report = analyzeSheetFinances(workbook.sheets[0]);

  assert.ok(report);
  assert.equal(report!.columns.debitIndex, 2);
  assert.equal(report!.columns.creditIndex, 3);
  assert.equal(report!.totalInflow, 1250);
  assert.equal(report!.totalOutflow, 400);
  assert.equal(report!.net, 850);
});

test('a lone debit column is treated as outflow, not inflow', async () => {
  const workbook = await workbookFromRows([
    ['Date', 'Narration', 'Debit'],
    ['2026-01-04', 'Supplier payment', '100'],
    ['2026-01-06', 'Bank charge', '25']
  ]);
  const report = analyzeSheetFinances(workbook.sheets[0]);

  assert.ok(report, 'expected a financial report');
  assert.equal(report!.columns.debitIndex, 2);
  assert.equal(report!.columns.creditIndex, -1);
  assert.equal(report!.totalInflow, 0);
  assert.equal(report!.totalOutflow, 125);
  assert.equal(report!.net, -125);
});

test('first-of-month dates stay in their calendar month regardless of timezone', async () => {
  const workbook = await workbookFromRows([
    ['Date', 'Description', 'Amount'],
    ['2026-01-01', 'January opening', '100'],
    ['2026-02-01', 'February opening', '200'],
    ['2026-03-01', 'March opening', '300']
  ]);
  const report = analyzeSheetFinances(workbook.sheets[0])!;

  assert.deepEqual(report.monthly.map((month) => month.month), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(report.monthly.map((month) => month.inflow), [100, 200, 300]);
});

test('non-financial sheets return no report', async () => {
  const workbook = await workbookFromRows([
    ['First name', 'Last name', 'City'],
    ['Ada', 'Lovelace', 'London'],
    ['Alan', 'Turing', 'Manchester']
  ]);

  assert.equal(analyzeSheetFinances(workbook.sheets[0]), null);
  assert.equal(analyzeWorkbookFinances(workbook), null);
});

test('AI fallback answers cashflow questions from the financial report without mutating data', async () => {
  const workbook = await parseFixture('sample_transactions.csv');
  const before = JSON.stringify(workbook);
  const response = await askWorkbookAi('What is my net cashflow and biggest expense?', workbook, []);

  assert.match(response.text, /net/i);
  assert.match(response.text, /inflow/i);
  assert.ok((response.findings?.length ?? 0) >= 1);
  assert.equal(response.findings?.[0].type, 'financial');
  assert.equal(JSON.stringify(workbook), before);
});
