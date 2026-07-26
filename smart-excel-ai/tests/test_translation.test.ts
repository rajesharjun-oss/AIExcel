import assert from 'node:assert/strict';
import {
  createTranslationFinding,
  detectSheetLanguage,
  isTranslatableCell,
  languageLabel,
  supportedLanguages,
  translatePhraseLocally,
  translateSheet,
  translateWorkbook
} from '../src/lib/translate';
import { buildWorkbookCopy, parseWorkbook, workbookCopyToArrayBuffer } from '../src/lib/workbook';
import { test } from './helpers/test-runner';
import { workbookFromRows, workbookFromSheets } from './helpers/workbook-fixtures';

test('translatable cell detection preserves numbers, dates, currency, and emails', () => {
  assert.equal(isTranslatableCell('Amount'), true);
  assert.equal(isTranslatableCell('Bank charge'), true);
  assert.equal(isTranslatableCell('1,000.50'), false);
  assert.equal(isTranslatableCell('₦2500'), false);
  assert.equal(isTranslatableCell('2026-02-01'), false);
  assert.equal(isTranslatableCell('01/02/2026'), false);
  assert.equal(isTranslatableCell('user@example.com'), false);
  assert.equal(isTranslatableCell(''), false);
  assert.equal(isTranslatableCell(undefined), false);
});

test('local dictionary translates known phrases and preserves casing', () => {
  assert.equal(translatePhraseLocally('Amount', 'es'), 'Importe');
  assert.equal(translatePhraseLocally('AMOUNT', 'fr'), 'MONTANT');
  assert.equal(translatePhraseLocally('pending', 'de'), 'ausstehend');
  assert.equal(translatePhraseLocally('Zvzxq unknown phrase', 'es'), null);
});

test('language detection recognizes dictionary phrases across a sheet', async () => {
  const workbook = await workbookFromRows([
    ['Fecha', 'Importe', 'Cliente'],
    ['2026-01-01', 1000, 'Empresa Uno'],
    ['2026-01-02', 2500, 'Empresa Dos']
  ]);
  assert.equal(detectSheetLanguage(workbook.sheets[0]), 'es');
});

test('sheet translation converts text cells, keeps data, and does not mutate the original', async () => {
  const workbook = await workbookFromRows([
    ['Date', 'Amount', 'Status'],
    ['2026-01-01', 1000, 'Paid'],
    ['2026-01-02', 2500, 'Pending']
  ]);
  const originalRows = JSON.stringify(workbook.sheets[0].rows);

  const result = await translateSheet(workbook, workbook.sheets[0].name, 'es');

  assert.ok(result.translatedCells >= 4);
  assert.equal(result.usedRemoteAi, false);
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.rows[0][0], 'Fecha');
  assert.equal(sheet.rows[0][1], 'Importe');
  assert.equal(sheet.rows[1][2], 'Pagado');
  assert.equal(sheet.rows[2][2], 'Pendiente');
  assert.equal(sheet.headers[0], 'Fecha');
  assert.equal(sheet.rows[1][1], workbook.sheets[0].rows[1][1]);
  assert.equal(JSON.stringify(workbook.sheets[0].rows), originalRows);
});

test('translation reports findings and supports revert via the original model', async () => {
  const workbook = await workbookFromRows([
    ['Name', 'Amount'],
    ['Bank', 500]
  ]);
  const result = await translateSheet(workbook, workbook.sheets[0].name, 'fr');
  const finding = createTranslationFinding(result);

  assert.equal(finding.title, 'Live translation applied');
  assert.equal(finding.sheetName, workbook.sheets[0].name);
  assert.ok(finding.detail.includes('French'));

  // Revert is the original untouched model.
  assert.equal(workbook.sheets[0].rows[0][0], 'Name');
  assert.equal(result.workbook.sheets[0].rows[0][0], 'Nom');
});

test('remote translation batches large sheets within the backend request limit', async () => {
  const longText = 'This value is far too long to translate remotely. '.repeat(12);
  const rows: Array<Array<string | number>> = [['Header']];
  for (let index = 0; index < 250; index += 1) {
    rows.push([`Unique phrase number ${index}`]);
  }
  rows.push([longText]);
  const workbook = await workbookFromRows(rows);

  const batchSizes: number[] = [];
  const requestedTexts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    batchSizes.push(body.texts.length);
    requestedTexts.push(...body.texts);
    return {
      ok: true,
      json: async () => ({ translations: body.texts.map((text: string) => `ES ${text}`), cached: false })
    };
  }) as typeof fetch;

  try {
    const result = await translateSheet(workbook, workbook.sheets[0].name, 'es');
    assert.equal(result.usedRemoteAi, true);
    assert.ok(batchSizes.length >= 2, `expected multiple batches, got ${batchSizes.length}`);
    assert.ok(batchSizes.every((size) => size <= 200), `batch sizes ${batchSizes.join(', ')}`);
    assert.equal(result.workbook.sheets[0].rows[1][0], 'ES Unique phrase number 0');
    assert.ok(!requestedTexts.includes(longText.trim()), 'over-length values must not be sent remotely');
    assert.equal(result.workbook.sheets[0].rows[rows.length - 1][0], longText);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('supported language list and labels stay consistent', () => {
  assert.ok(supportedLanguages.length >= 6);
  assert.equal(languageLabel('es'), 'Spanish');
  assert.equal(languageLabel('pt'), 'Portuguese');
  assert.equal(languageLabel('it'), 'Italian');
  supportedLanguages.forEach((language) => {
    assert.ok(language.code.length === 2);
    assert.ok(language.label.length > 1);
  });
});

test('Italian dictionary translates common spreadsheet phrases', () => {
  assert.equal(translatePhraseLocally('Amount', 'it'), 'Importo');
  assert.equal(translatePhraseLocally('Invoice', 'it'), 'Fattura');
  assert.equal(translatePhraseLocally('PENDING', 'it'), 'IN SOSPESO');
  assert.equal(translatePhraseLocally('Fecha', 'it'), 'Data');
});

test('whole-workbook translation covers every sheet without mutating the original', async () => {
  const workbook = await workbookFromSheets({
    Invoices: [
      ['Date', 'Amount', 'Status'],
      ['2026-01-01', 1200, 'Paid']
    ],
    Customers: [
      ['Name', 'City'],
      ['Acme Ltd', 'Lagos']
    ]
  });
  const originalSnapshot = JSON.stringify(workbook.sheets.map((sheet) => sheet.rows));

  const result = await translateWorkbook(workbook, 'es');

  assert.deepEqual(result.sheetNames, ['Invoices', 'Customers']);
  assert.equal(result.sheetName, '2 sheets');
  const [invoices, customers] = result.workbook.sheets;
  assert.equal(invoices.rows[0][0], 'Fecha');
  assert.equal(invoices.rows[1][2], 'Pagado');
  assert.equal(invoices.rows[1][1], workbook.sheets[0].rows[1][1]);
  assert.equal(customers.rows[0][0], 'Nombre');
  assert.equal(customers.rows[0][1], 'Ciudad');
  assert.equal(customers.headers[0], 'Nombre');
  assert.equal(JSON.stringify(workbook.sheets.map((sheet) => sheet.rows)), originalSnapshot);
});

test('workbook copy export round-trips current values including translations', async () => {
  const workbook = await workbookFromSheets({
    Data: [
      ['Status', 'Amount'],
      ['Pending', 900]
    ]
  });
  const translated = await translateWorkbook(workbook, 'fr');
  assert.equal(translated.workbook.sheets[0].rows[1][0], 'En attente');

  const bytes = workbookCopyToArrayBuffer(translated.workbook);
  const file = new File([Buffer.from(bytes)], 'copy.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const reread = await parseWorkbook(file as unknown as globalThis.File);

  assert.equal(reread.sheets[0].headers[0], 'Statut');
  assert.equal(reread.sheets[0].rows[1][0], 'En attente');
  assert.equal(String(reread.sheets[0].rows[1][1]), '900');

  // Numeric-looking display strings must export as real numeric cells.
  const copyBook = buildWorkbookCopy(translated.workbook);
  const amountCell = copyBook.Sheets[copyBook.SheetNames[0]]['B2'];
  assert.equal(amountCell.t, 'n');
  assert.equal(amountCell.v, 900);
});
