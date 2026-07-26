import type {
  CellValue,
  FinancialAnomaly,
  FinancialColumnMap,
  FinancialGroupTotal,
  FinancialReport,
  Finding,
  MonthlyTotal,
  SheetData,
  WorkbookModel
} from '../types';
import { cellToText, isBlank, normalizeText, parseNumericValue } from './workbook';

const CURRENCY_SYMBOLS = ['₦', '$', '€', '£', '¥', '₹'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dataRowsOf = (sheet: SheetData): CellValue[][] => sheet.rows.slice(sheet.dataStartIndex);

const headerMatches = (sheet: SheetData, pattern: RegExp): number =>
  sheet.headers.findIndex((header) => pattern.test(normalizeText(header)));

const looksLikeDate = (value: CellValue | undefined): boolean => {
  if (value instanceof Date) return true;
  const text = cellToText(value).trim();
  if (!text || /^\d+(\.\d+)?$/.test(text)) return false;
  if (!/[-/.]/.test(text) && !/[a-z]{3}/i.test(text)) return false;
  return !Number.isNaN(Date.parse(text));
};

const columnDateRatio = (sheet: SheetData, columnIndex: number): number => {
  const values = dataRowsOf(sheet)
    .map((row) => row[columnIndex])
    .filter((value) => !isBlank(value));
  if (!values.length) return 0;
  return values.filter(looksLikeDate).length / values.length;
};

const columnNumberRatio = (sheet: SheetData, columnIndex: number): number => {
  const values = dataRowsOf(sheet)
    .map((row) => row[columnIndex])
    .filter((value) => !isBlank(value));
  if (!values.length) return 0;
  return values.filter((value) => parseNumericValue(value) !== null).length / values.length;
};

const detectDateIndex = (sheet: SheetData): number => {
  const byHeader = headerMatches(sheet, /(^|\b)(date|posted|value date|transaction date|txn date|day)(\b|$)/);
  if (byHeader >= 0 && columnDateRatio(sheet, byHeader) >= 0.4) return byHeader;
  let best = -1;
  let bestRatio = 0.6;
  sheet.headers.forEach((_, index) => {
    const ratio = columnDateRatio(sheet, index);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = index;
    }
  });
  return best;
};

const detectAmountColumns = (sheet: SheetData, dateIndex: number): Pick<FinancialColumnMap, 'amountIndex' | 'debitIndex' | 'creditIndex'> => {
  const rawDebitIndex = headerMatches(sheet, /(debit|withdrawal|money out|paid out|\bdr\b|outflow|expense|spent)/);
  const rawCreditIndex = headerMatches(sheet, /(credit|deposit|money in|paid in|\bcr\b|inflow|income|received)/);
  // Keep a lone debit or credit column too: bank exports often have only one,
  // and its sign convention must survive (a debit-only column is outflow).
  const numericEnough = (index: number) => index >= 0 && columnNumberRatio(sheet, index) >= 0.4;
  const debitIndex = numericEnough(rawDebitIndex) ? rawDebitIndex : -1;
  const creditIndex = numericEnough(rawCreditIndex) ? rawCreditIndex : -1;
  if ((debitIndex >= 0 || creditIndex >= 0) && debitIndex !== creditIndex) {
    return { amountIndex: -1, debitIndex, creditIndex };
  }

  const amountByHeader = sheet.headers.findIndex((header) => {
    const normalized = normalizeText(header);
    return /(amount|amt|value|total|price|cost|balance change|net)/.test(normalized) && !/\b(balance|running)\b/.test(normalized);
  });
  if (amountByHeader >= 0 && columnNumberRatio(sheet, amountByHeader) >= 0.4) {
    return { amountIndex: amountByHeader, debitIndex: -1, creditIndex: -1 };
  }

  let best = -1;
  let bestRatio = 0.6;
  sheet.headers.forEach((_, index) => {
    if (index === dateIndex) return;
    const ratio = columnNumberRatio(sheet, index);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = index;
    }
  });
  return { amountIndex: best, debitIndex: -1, creditIndex: -1 };
};

export const detectFinancialColumns = (sheet: SheetData): FinancialColumnMap => {
  const dateIndex = detectDateIndex(sheet);
  const { amountIndex, debitIndex, creditIndex } = detectAmountColumns(sheet, dateIndex);
  const categoryIndex = headerMatches(sheet, /(categor|type|group|class|bucket|account type)/);
  const descriptionIndex = headerMatches(sheet, /(description|narration|detail|memo|payee|merchant|particular|reference|remark|note|vendor|beneficiary)/);
  return { dateIndex, amountIndex, debitIndex, creditIndex, categoryIndex, descriptionIndex };
};

const rowAmount = (row: CellValue[], columns: FinancialColumnMap): number | null => {
  if (columns.amountIndex >= 0) {
    return parseNumericValue(row[columns.amountIndex]);
  }
  if (columns.debitIndex >= 0 || columns.creditIndex >= 0) {
    const credit = columns.creditIndex >= 0 ? parseNumericValue(row[columns.creditIndex]) : null;
    const debit = columns.debitIndex >= 0 ? parseNumericValue(row[columns.debitIndex]) : null;
    if (credit === null && debit === null) return null;
    return (credit ?? 0) - Math.abs(debit ?? 0);
  }
  return null;
};

const rowLabel = (row: CellValue[], columns: FinancialColumnMap, groupIndex: number): string => {
  const raw = groupIndex >= 0 ? cellToText(row[groupIndex]).trim() : '';
  if (raw) return raw;
  const description = columns.descriptionIndex >= 0 ? cellToText(row[columns.descriptionIndex]).trim() : '';
  return description || 'Uncategorized';
};

const detectCurrencySymbol = (sheet: SheetData, columns: FinancialColumnMap): string => {
  const indexes = [columns.amountIndex, columns.debitIndex, columns.creditIndex].filter((index) => index >= 0);
  for (const row of dataRowsOf(sheet)) {
    for (const index of indexes) {
      const text = cellToText(row[index]);
      const symbol = CURRENCY_SYMBOLS.find((candidate) => text.includes(candidate));
      if (symbol) return symbol;
    }
  }
  return '';
};

const monthKey = (value: CellValue | undefined): { month: string; label: string } | null => {
  if (isBlank(value)) return null;
  let year: number;
  let monthIndex: number;

  if (value instanceof Date) {
    year = value.getFullYear();
    monthIndex = value.getMonth();
  } else {
    const text = cellToText(value).trim();
    // Date-only strings like 2026-01-01 parse as UTC instants, so reading them
    // with local getters shifts first-of-month rows into the previous month in
    // negative UTC offsets. Read the calendar components directly instead.
    const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
    if (isoMatch) {
      year = Number(isoMatch[1]);
      monthIndex = Number(isoMatch[2]) - 1;
    } else {
      const date = new Date(text);
      if (Number.isNaN(date.getTime())) return null;
      year = date.getFullYear();
      monthIndex = date.getMonth();
    }
  }

  if (monthIndex < 0 || monthIndex > 11) return null;
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    label: `${MONTH_LABELS[monthIndex]} ${year}`
  };
};

const detectAnomalies = (
  entries: Array<{ rowNumber: number; amount: number; description: string }>
): FinancialAnomaly[] => {
  const magnitudes = entries.map((entry) => Math.abs(entry.amount)).sort((a, b) => a - b);
  if (magnitudes.length < 6) return [];
  const quantile = (fraction: number): number => {
    const position = (magnitudes.length - 1) * fraction;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    if (low === high) return magnitudes[low];
    return magnitudes[low] + (magnitudes[high] - magnitudes[low]) * (position - low);
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return [];
  const upperFence = q3 + iqr * 1.5;
  return entries
    .filter((entry) => Math.abs(entry.amount) > upperFence)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 12)
    .map((entry) => ({
      ...entry,
      reason: `${Math.abs(entry.amount) >= q3 * 3 ? 'Far above' : 'Above'} the typical range (upper fence ${Math.round(upperFence).toLocaleString()}).`
    }));
};

export const analyzeSheetFinances = (sheet: SheetData): FinancialReport | null => {
  const columns = detectFinancialColumns(sheet);
  if (columns.amountIndex < 0 && columns.debitIndex < 0 && columns.creditIndex < 0) return null;

  const groupIndex = columns.categoryIndex >= 0 ? columns.categoryIndex : columns.descriptionIndex;
  const entries: Array<{ rowNumber: number; amount: number; description: string; date: CellValue | undefined }> = [];

  dataRowsOf(sheet).forEach((row, offset) => {
    const amount = rowAmount(row, columns);
    if (amount === null || amount === 0) return;
    entries.push({
      rowNumber: sheet.dataStartIndex + offset + 1,
      amount,
      description: rowLabel(row, columns, groupIndex),
      date: columns.dateIndex >= 0 ? row[columns.dateIndex] : undefined
    });
  });

  if (!entries.length) return null;

  let totalInflow = 0;
  let totalOutflow = 0;
  const groups = new Map<string, FinancialGroupTotal>();
  const months = new Map<string, MonthlyTotal>();
  let largestInflow: FinancialReport['largestInflow'] = null;
  let largestOutflow: FinancialReport['largestOutflow'] = null;

  entries.forEach((entry) => {
    const inflow = entry.amount > 0 ? entry.amount : 0;
    const outflow = entry.amount < 0 ? Math.abs(entry.amount) : 0;
    totalInflow += inflow;
    totalOutflow += outflow;

    if (inflow > 0 && (!largestInflow || entry.amount > largestInflow.amount)) {
      largestInflow = { rowNumber: entry.rowNumber, amount: entry.amount, description: entry.description };
    }
    if (outflow > 0 && (!largestOutflow || entry.amount < largestOutflow.amount)) {
      largestOutflow = { rowNumber: entry.rowNumber, amount: entry.amount, description: entry.description };
    }

    const group = groups.get(entry.description) ?? { label: entry.description, total: 0, inflow: 0, outflow: 0, count: 0 };
    group.total += entry.amount;
    group.inflow += inflow;
    group.outflow += outflow;
    group.count += 1;
    groups.set(entry.description, group);

    const monthInfo = monthKey(entry.date);
    if (monthInfo) {
      const bucket = months.get(monthInfo.month) ?? { month: monthInfo.month, label: monthInfo.label, inflow: 0, outflow: 0, net: 0, count: 0 };
      bucket.inflow += inflow;
      bucket.outflow += outflow;
      bucket.net += entry.amount;
      bucket.count += 1;
      months.set(monthInfo.month, bucket);
    }
  });

  const categories = Array.from(groups.values())
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 12);
  const monthly = Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));
  const anomalies = detectAnomalies(entries.map(({ rowNumber, amount, description }) => ({ rowNumber, amount, description })));

  return {
    sheetName: sheet.name,
    currencySymbol: detectCurrencySymbol(sheet, columns),
    columns,
    transactionCount: entries.length,
    totalInflow,
    totalOutflow,
    net: totalInflow - totalOutflow,
    averageAmount: entries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0) / entries.length,
    largestInflow,
    largestOutflow,
    groupedBy: columns.categoryIndex >= 0 ? sheet.headers[columns.categoryIndex] : columns.descriptionIndex >= 0 ? sheet.headers[columns.descriptionIndex] : 'Transaction',
    categories,
    monthly,
    anomalies
  };
};

const scoreSheet = (report: FinancialReport | null): number => {
  if (!report) return 0;
  return report.transactionCount + (report.columns.dateIndex >= 0 ? 25 : 0) + (report.monthly.length > 1 ? 15 : 0);
};

export const analyzeWorkbookFinances = (workbook: WorkbookModel, preferredSheetName?: string): FinancialReport | null => {
  const reports = workbook.sheets.map((sheet) => ({ sheet, report: analyzeSheetFinances(sheet) }));
  const usable = reports.filter((entry): entry is { sheet: SheetData; report: FinancialReport } => entry.report !== null);
  if (!usable.length) return null;

  if (preferredSheetName) {
    const preferred = usable.find((entry) => entry.sheet.name === preferredSheetName);
    if (preferred) return preferred.report;
  }

  return usable.sort((a, b) => scoreSheet(b.report) - scoreSheet(a.report))[0].report;
};

export const formatMoney = (value: number, currencySymbol = ''): string => {
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  const formatted = magnitude.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${currencySymbol}${formatted}`;
};

export const financialFindings = (report: FinancialReport): Finding[] => {
  const findings: Finding[] = [];
  const symbol = report.currencySymbol;
  const netPositive = report.net >= 0;

  findings.push({
    id: 'financial-overview',
    type: 'financial',
    severity: 'info',
    title: 'Cashflow overview',
    sheetName: report.sheetName,
    detail: `${report.transactionCount} transactions. Inflow ${formatMoney(report.totalInflow, symbol)}, outflow ${formatMoney(report.totalOutflow, symbol)}, net ${formatMoney(report.net, symbol)}.`,
    suggestion: netPositive ? 'Net position is positive across the analyzed rows.' : 'Outflow exceeds inflow across the analyzed rows.',
    preview: report.categories.slice(0, 5).map((category) => `${category.label}: net ${formatMoney(category.total, symbol)} (${category.count})`)
  });

  if (report.largestOutflow) {
    findings.push({
      id: 'financial-largest-outflow',
      type: 'financial',
      severity: 'medium',
      title: 'Largest outflow',
      sheetName: report.sheetName,
      rows: [report.largestOutflow.rowNumber],
      detail: `${formatMoney(report.largestOutflow.amount, symbol)} — ${report.largestOutflow.description} (row ${report.largestOutflow.rowNumber}).`
    });
  }

  if (report.anomalies.length) {
    findings.push({
      id: 'financial-anomalies',
      type: 'financial',
      severity: 'high',
      title: `${report.anomalies.length} unusual amount${report.anomalies.length === 1 ? '' : 's'}`,
      sheetName: report.sheetName,
      rows: report.anomalies.slice(0, 10).map((anomaly) => anomaly.rowNumber),
      detail: 'Amounts sit well outside the typical range for this sheet and are worth confirming.',
      suggestion: 'Check for an extra zero, a wrong currency, or an imported total row.',
      preview: report.anomalies.slice(0, 5).map((anomaly) => `Row ${anomaly.rowNumber}: ${formatMoney(anomaly.amount, symbol)} — ${anomaly.description}`)
    });
  }

  return findings;
};
