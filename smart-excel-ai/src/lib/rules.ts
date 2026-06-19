import type { RuleAnalysisResult, RuleDefinition, SheetData } from '../types';
import { cellToText, isBlank, normalizeText, parseNumericValue } from './workbook';

const findHeaderIndex = (sheet: SheetData, headerName: string): number =>
  sheet.headers.findIndex((header) => normalizeText(header) === normalizeText(headerName));

const findFirstMatchingHeader = (sheet: SheetData, candidates: RegExp[]): number =>
  sheet.headers.findIndex((header) => candidates.some((candidate) => candidate.test(normalizeText(header))));

export const defaultRules: RuleDefinition[] = [
  {
    id: 'firs',
    name: 'FIRS transactions',
    matchColumn: 'Description',
    contains: ['FIRS'],
    category: 'FIRS'
  },
  {
    id: 'sirs',
    name: 'State IRS transactions',
    matchColumn: 'Description',
    contains: ['LIRS', 'State IRS'],
    category: 'SIRS'
  },
  {
    id: 'bank-charges',
    name: 'Bank charges',
    matchColumn: 'Description',
    contains: ['bank charge', 'charges', 'sms alert', 'maintenance fee'],
    category: 'Bank Charges'
  }
];

export const applyRulesToSheet = (
  sheet: SheetData,
  rules: RuleDefinition[] = defaultRules,
  amountColumnName = 'Amount'
): RuleAnalysisResult => {
  const amountIndex = findHeaderIndex(sheet, amountColumnName);
  const fallbackAmountIndex = amountIndex >= 0 ? amountIndex : findFirstMatchingHeader(sheet, [/amount/, /debit/, /credit/, /value/]);
  const dataRows = sheet.rows.slice(sheet.dataStartIndex);

  const rows = dataRows.map((row, offset) => {
    const rowNumber = sheet.dataStartIndex + offset + 1;
    const values = Object.fromEntries(sheet.headers.map((header, index) => [header, row[index] ?? null]));
    const matchedRule = rules.find((rule) => {
      const columnIndex = findHeaderIndex(sheet, rule.matchColumn);
      if (columnIndex < 0) return false;
      const haystack = normalizeText(row[columnIndex]);
      return rule.contains.some((term) => haystack.includes(normalizeText(term)));
    });
    const rawAmount = fallbackAmountIndex >= 0 ? row[fallbackAmountIndex] : null;
    const amount = parseNumericValue(rawAmount);
    const reviewFlags: string[] = [];

    if (fallbackAmountIndex < 0 || isBlank(rawAmount)) {
      reviewFlags.push('blank_amount');
    } else if (amount === null) {
      reviewFlags.push('invalid_amount');
    }

    if (!matchedRule) {
      reviewFlags.push('uncategorized');
    }

    return {
      rowNumber,
      category: matchedRule?.category ?? 'Unallocated',
      matchedRuleId: matchedRule?.id,
      reviewFlags,
      amount,
      values
    };
  });

  const total = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  return {
    sheetName: sheet.name,
    totalRows: rows.length,
    categorizedRows: rows.filter((row) => row.category !== 'Unallocated').length,
    uncategorizedRows: rows.filter((row) => row.category === 'Unallocated').length,
    invalidAmountRows: rows.filter((row) => row.reviewFlags.includes('blank_amount') || row.reviewFlags.includes('invalid_amount')).length,
    totalBefore: total,
    totalAfter: total,
    rows
  };
};

export const resultRowsByCategory = (result: RuleAnalysisResult, category: string) =>
  result.rows.filter((row) => row.category === category);
