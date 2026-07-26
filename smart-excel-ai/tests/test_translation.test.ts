import assert from 'node:assert/strict';
import {
  createTranslationFinding,
  detectSheetLanguage,
  isTranslatableCell,
  languageLabel,
  supportedLanguages,
  translatePhraseLocally,
  translateSheet
} from '../src/lib/translate';
import { test } from './helpers/test-runner';
import { workbookFromRows } from './helpers/workbook-fixtures';

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

test('supported language list and labels stay consistent', () => {
  assert.ok(supportedLanguages.length >= 5);
  assert.equal(languageLabel('es'), 'Spanish');
  assert.equal(languageLabel('pt'), 'Portuguese');
  supportedLanguages.forEach((language) => {
    assert.ok(language.code.length === 2);
    assert.ok(language.label.length > 1);
  });
});
