import * as XLSX from 'xlsx';
import type { CellValue, ColumnProfile, Finding, SheetData, WorkbookModel, WorkbookProfile } from '../types';

const MAX_PREVIEW_ROWS = 200;

export const isBlank = (value: CellValue | undefined): boolean => {
  if (value === null || value === undefined) return true;
  return String(value).trim() === '';
};

export const cellToText = (value: CellValue | undefined): string => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return '';
  return String(value);
};

export const normalizeText = (value: CellValue | undefined): string =>
  cellToText(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const normalizeHeader = (value: CellValue | undefined, index: number): string => {
  const text = cellToText(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || `Column ${index + 1}`;
};

const rowDensity = (row: CellValue[]): number => row.filter((cell) => !isBlank(cell)).length;

const detectHeaderRow = (rows: CellValue[][]): number => {
  const sample = rows.slice(0, 12);
  let bestIndex = 0;
  let bestScore = -1;

  sample.forEach((row, index) => {
    const nonEmpty = rowDensity(row);
    const textLike = row.filter((cell) => /[a-zA-Z]/.test(cellToText(cell))).length;
    const unique = new Set(row.map((cell, cellIndex) => normalizeHeader(cell, cellIndex).toLowerCase())).size;
    const score = nonEmpty * 2 + textLike + unique * 0.5 - index * 0.15;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
};

const normalizeSheetRows = (rows: CellValue[][]): CellValue[][] => {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? null));
};

export const parseWorkbook = async (file: File): Promise<WorkbookModel> => {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, {
    type: 'array',
    cellDates: true,
    raw: false,
    dense: false
  });

  const sheets = workbook.SheetNames.map((name): SheetData => {
    const worksheet = workbook.Sheets[name];
    const rawRows = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
      header: 1,
      defval: null,
      blankrows: false,
      raw: false
    });
    const rows = normalizeSheetRows(rawRows);
    const headerRowIndex = detectHeaderRow(rows);
    const headers = rows[headerRowIndex]?.map((cell, index) => normalizeHeader(cell, index)) ?? [];
    const columnCount = Math.max(headers.length, ...rows.map((row) => row.length));

    return {
      name,
      rows,
      headers: Array.from({ length: columnCount }, (_, index) => headers[index] || `Column ${index + 1}`),
      headerRowIndex,
      dataStartIndex: headerRowIndex + 1,
      rowCount: Math.max(0, rows.length - headerRowIndex - 1),
      columnCount
    };
  });

  return {
    fileName: file.name,
    importedAt: new Date().toISOString(),
    sheets
  };
};

const inferValueType = (value: CellValue): ColumnProfile['inferredType'] => {
  const text = cellToText(value).trim();
  if (!text) return 'empty';
  if (/^(true|false|yes|no)$/i.test(text)) return 'boolean';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email';
  if (/^[\u20a6$\u20ac\u00a3]?\s?-?[\d,]+(\.\d+)?$/.test(text)) return /^[\u20a6$\u20ac\u00a3]/.test(text) ? 'currency' : 'number';
  if (!Number.isNaN(Date.parse(text)) && /[-/]/.test(text)) return 'date';
  return 'text';
};

const dominantType = (types: ColumnProfile['inferredType'][]): ColumnProfile['inferredType'] => {
  const counts = types.reduce<Record<string, number>>((acc, type) => {
    if (type !== 'empty') acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'empty';
  const [winner, count] = entries[0];
  const total = types.filter((type) => type !== 'empty').length;
  return count / Math.max(1, total) < 0.8 ? 'mixed' : (winner as ColumnProfile['inferredType']);
};

export const buildColumnProfile = (sheet: SheetData, columnIndex: number): ColumnProfile => {
  const values = sheet.rows.slice(sheet.dataStartIndex).map((row) => row[columnIndex] ?? null);
  const nonEmptyValues = values.filter((value) => !isBlank(value));
  const examples = Array.from(new Set(nonEmptyValues.map(cellToText).filter(Boolean))).slice(0, 4);

  return {
    sheetName: sheet.name,
    header: sheet.headers[columnIndex] || `Column ${columnIndex + 1}`,
    index: columnIndex,
    nonEmptyCount: nonEmptyValues.length,
    missingCount: values.length - nonEmptyValues.length,
    inferredType: dominantType(values.map(inferValueType)),
    examples
  };
};

export const buildWorkbookProfile = (workbook: WorkbookModel): WorkbookProfile => {
  const sheetProfiles = workbook.sheets.map((sheet) => ({
    name: sheet.name,
    rows: sheet.rowCount,
    columns: sheet.columnCount,
    headers: sheet.headers,
    columnsProfile: sheet.headers.map((_, index) => buildColumnProfile(sheet, index))
  }));

  const relationshipHints: WorkbookProfile['relationshipHints'] = [];
  for (let i = 0; i < sheetProfiles.length; i += 1) {
    for (let j = i + 1; j < sheetProfiles.length; j += 1) {
      for (const left of sheetProfiles[i].columnsProfile) {
        for (const right of sheetProfiles[j].columnsProfile) {
          const leftHeader = normalizeText(left.header);
          const rightHeader = normalizeText(right.header);
          const bothHaveValues = left.nonEmptyCount > 0 && right.nonEmptyCount > 0;
          if (bothHaveValues && leftHeader === rightHeader) {
            relationshipHints.push({
              leftSheet: left.sheetName,
              leftColumn: left.header,
              rightSheet: right.sheetName,
              rightColumn: right.header,
              reason: 'Matching column names'
            });
          } else if (bothHaveValues && /(id|number|code|account|invoice|customer)/.test(`${leftHeader} ${rightHeader}`) && leftHeader.includes(rightHeader)) {
            relationshipHints.push({
              leftSheet: left.sheetName,
              leftColumn: left.header,
              rightSheet: right.sheetName,
              rightColumn: right.header,
              reason: 'Possible shared identifier'
            });
          }
        }
      }
    }
  }

  return {
    fileName: workbook.fileName,
    sheetCount: workbook.sheets.length,
    totalRows: workbook.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    totalColumns: workbook.sheets.reduce((sum, sheet) => sum + sheet.columnCount, 0),
    sheets: sheetProfiles,
    relationshipHints: relationshipHints.slice(0, 40)
  };
};

const rowSignature = (row: CellValue[]): string =>
  row
    .map(normalizeText)
    .filter(Boolean)
    .join(' | ');

const rowPreview = (sheet: SheetData, rowIndex: number): string => {
  const row = sheet.rows[rowIndex] ?? [];
  return sheet.headers
    .map((header, index) => `${header}: ${cellToText(row[index])}`)
    .filter((part) => !part.endsWith(': '))
    .slice(0, 6)
    .join(' | ');
};

const findColumnIndex = (sheet: SheetData, patterns: RegExp[]): number =>
  sheet.headers.findIndex((header) => patterns.some((pattern) => pattern.test(normalizeText(header))));

export const parseNumericValue = (value: CellValue | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cellToText(value).trim();
  if (!text) return null;
  const normalized = text.replace(/[,\s]/g, '').replace(/^[\u20a6$\u20ac\u00a3]/, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const findDuplicates = (workbook: WorkbookModel): Finding[] => {
  const seen = new Map<string, Array<{ sheet: SheetData; rowIndex: number }>>();

  workbook.sheets.forEach((sheet) => {
    sheet.rows.slice(sheet.dataStartIndex).forEach((row, offset) => {
      const rowIndex = sheet.dataStartIndex + offset;
      const signature = rowSignature(row);
      if (signature.length < 4) return;
      const locations = seen.get(signature) ?? [];
      locations.push({ sheet, rowIndex });
      seen.set(signature, locations);
    });
  });

  return Array.from(seen.entries())
    .filter(([, locations]) => locations.length > 1)
    .slice(0, 80)
    .map(([signature, locations], index) => {
      const sheets = Array.from(new Set(locations.map((location) => location.sheet.name)));
      const rowNumbers = locations.map((location) => location.rowIndex + 1);
      return {
        id: `duplicate-${index}`,
        type: 'duplicate',
        severity: sheets.length > 1 ? 'high' : 'medium',
        title: sheets.length > 1 ? 'Duplicate row across sheets' : 'Duplicate row in sheet',
        sheetName: sheets.join(', '),
        rows: rowNumbers,
        detail: `The same normalized row appears ${locations.length} times. Signature: ${signature.slice(0, 180)}`,
        suggestion: 'Review the rows before deleting; cross-sheet duplicates may represent legitimate mirrored records.',
        preview: locations.slice(0, 5).map((location) => `${location.sheet.name} row ${location.rowIndex + 1}: ${rowPreview(location.sheet, location.rowIndex)}`)
      } satisfies Finding;
    });
};

export const findInconsistencies = (workbook: WorkbookModel): Finding[] => {
  const findings: Finding[] = [];

  workbook.sheets.forEach((sheet) => {
    const normalizedHeaders = sheet.headers.map((header) => normalizeText(header));
    const duplicateHeaders = normalizedHeaders.filter((header, index) => header && normalizedHeaders.indexOf(header) !== index);
    if (duplicateHeaders.length) {
      findings.push({
        id: `headers-${sheet.name}`,
        type: 'inconsistency',
        severity: 'high',
        title: 'Duplicate column headers',
        sheetName: sheet.name,
        columns: Array.from(new Set(duplicateHeaders)),
        detail: `${sheet.name} has repeated header names, which can cause formulas and AI matching to target the wrong column.`,
        suggestion: 'Rename repeated headers so each column is unique.'
      });
    }

    sheet.headers.forEach((header, columnIndex) => {
      const profile = buildColumnProfile(sheet, columnIndex);
      const missingRatio = profile.missingCount / Math.max(1, sheet.rowCount);

      if (profile.inferredType === 'mixed' && profile.nonEmptyCount >= 5) {
        findings.push({
          id: `mixed-${sheet.name}-${columnIndex}`,
          type: 'inconsistency',
          severity: 'medium',
          title: 'Mixed data types in a column',
          sheetName: sheet.name,
          columns: [header],
          detail: `${header} contains values that look like different data types. Examples: ${profile.examples.join(', ')}`,
          suggestion: 'Standardize this column before analysis, especially if it is used for matching or totals.'
        });
      }

      if (missingRatio >= 0.35 && sheet.rowCount >= 5) {
        findings.push({
          id: `missing-${sheet.name}-${columnIndex}`,
          type: 'missing',
          severity: missingRatio >= 0.7 ? 'high' : 'medium',
          title: 'Many missing values',
          sheetName: sheet.name,
          columns: [header],
          detail: `${header} is blank in ${Math.round(missingRatio * 100)}% of data rows.`,
          suggestion: 'Confirm whether this column is optional. If it is important, fill or remove incomplete records.'
        });
      }

      if (/(required|ref|reference|id|number|code)/.test(normalizeText(header))) {
        sheet.rows.slice(sheet.dataStartIndex).forEach((row, offset) => {
          if (!isBlank(row[columnIndex])) return;
          const rowIndex = sheet.dataStartIndex + offset;
          findings.push({
            id: `required-blank-${sheet.name}-${columnIndex}-${rowIndex}`,
            type: 'missing',
            severity: 'high',
            title: 'Blank required field',
            sheetName: sheet.name,
            rows: [rowIndex + 1],
            columns: [header],
            detail: `${header} is blank on row ${rowIndex + 1}.`,
            suggestion: 'Fill the required value or flag the row for review before analysis.',
            preview: [rowPreview(sheet, rowIndex)]
          });
        });
      }
    });

    const amountIndex = findColumnIndex(sheet, [/amount/, /debit/, /credit/, /value/]);
    if (amountIndex >= 0) {
      const amountEntries = sheet.rows
        .slice(sheet.dataStartIndex)
        .map((row, offset) => ({
          rowIndex: sheet.dataStartIndex + offset,
          value: row[amountIndex],
          parsed: parseNumericValue(row[amountIndex])
        }))
        .filter((entry) => !isBlank(entry.value));

      amountEntries
        .filter((entry) => entry.parsed === null)
        .slice(0, 20)
        .forEach((entry) => {
          findings.push({
            id: `invalid-number-${sheet.name}-${entry.rowIndex}`,
            type: 'inconsistency',
            severity: 'high',
            title: 'Invalid number in amount column',
            sheetName: sheet.name,
            rows: [entry.rowIndex + 1],
            columns: [sheet.headers[amountIndex]],
            detail: `${sheet.headers[amountIndex]} contains "${cellToText(entry.value)}", which cannot be read as a number.`,
            suggestion: 'Correct the value before categorizing, reconciling, or exporting totals.',
            preview: [rowPreview(sheet, entry.rowIndex)]
          });
        });

      const typicalAmounts = amountEntries
        .map((entry) => entry.parsed)
        .filter((value): value is number => value !== null)
        .map(Math.abs)
        .sort((a, b) => a - b);

      if (typicalAmounts.length >= 5) {
        const median = typicalAmounts[Math.floor(typicalAmounts.length / 2)] || 0;
        amountEntries
          .filter((entry) => entry.parsed !== null && median > 0 && Math.abs(entry.parsed) >= median * 10)
          .slice(0, 20)
          .forEach((entry) => {
            findings.push({
              id: `outlier-${sheet.name}-${entry.rowIndex}`,
              type: 'inconsistency',
              severity: 'medium',
              title: 'Unusual amount',
              sheetName: sheet.name,
              rows: [entry.rowIndex + 1],
              columns: [sheet.headers[amountIndex]],
              detail: `${sheet.headers[amountIndex]} is much larger than the typical amount in this sheet.`,
              suggestion: 'Confirm this is not an extra zero, wrong currency, or imported total row.',
              preview: [rowPreview(sheet, entry.rowIndex)]
            });
          });
      }
    }

    sheet.rows.forEach((row, rowIndex) => {
      if (rowIndex <= sheet.headerRowIndex) return;
      const nonEmpty = rowDensity(row);
      if (nonEmpty > 0 && nonEmpty <= Math.max(1, Math.floor(sheet.columnCount * 0.2))) {
        findings.push({
          id: `sparse-${sheet.name}-${rowIndex}`,
          type: 'inconsistency',
          severity: 'low',
          title: 'Sparse row',
          sheetName: sheet.name,
          rows: [rowIndex + 1],
          detail: `Row ${rowIndex + 1} has only ${nonEmpty} filled cell${nonEmpty === 1 ? '' : 's'}.`,
          suggestion: 'Check whether this is a subtotal, note, separator, or incomplete data row.',
          preview: [rowPreview(sheet, rowIndex)]
        });
      }
    });
  });

  return findings.slice(0, 120);
};

export const searchWorkbook = (workbook: WorkbookModel, query: string): Finding[] => {
  const terms = query
    .toLowerCase()
    .replace(/[^\w\s.-]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 2)
    .filter((term) => !['find', 'show', 'data', 'sheet', 'across', 'where', 'with', 'the', 'for', 'all'].includes(term));

  if (!terms.length) return [];

  const findings: Finding[] = [];
  workbook.sheets.forEach((sheet) => {
    sheet.rows.forEach((row, rowIndex) => {
      const haystack = row.map(normalizeText).join(' ');
      if (terms.every((term) => haystack.includes(term))) {
        findings.push({
          id: `search-${sheet.name}-${rowIndex}-${findings.length}`,
          type: 'search',
          severity: 'info',
          title: 'Matching row found',
          sheetName: sheet.name,
          rows: [rowIndex + 1],
          detail: `Matched "${terms.join(' ')}" on ${sheet.name} row ${rowIndex + 1}.`,
          preview: [rowPreview(sheet, rowIndex)]
        });
      }
    });
  });

  return findings.slice(0, 80);
};

export const compareSheets = (workbook: WorkbookModel, leftName: string, rightName: string): Finding[] => {
  const left = workbook.sheets.find((sheet) => normalizeText(sheet.name) === normalizeText(leftName));
  const right = workbook.sheets.find((sheet) => normalizeText(sheet.name) === normalizeText(rightName));
  if (!left || !right) return [];

  const rightRows = new Set(right.rows.slice(right.dataStartIndex).map(rowSignature));
  const missing = left.rows
    .slice(left.dataStartIndex)
    .map((row, offset) => ({ row, rowIndex: left.dataStartIndex + offset, signature: rowSignature(row) }))
    .filter((entry) => entry.signature && !rightRows.has(entry.signature))
    .slice(0, 60);

  return missing.map((entry, index) => ({
    id: `compare-${left.name}-${right.name}-${index}`,
    type: 'relationship',
    severity: 'medium',
    title: 'Row missing from comparison sheet',
    sheetName: left.name,
    rows: [entry.rowIndex + 1],
    detail: `This row exists in ${left.name} but does not have an exact normalized match in ${right.name}.`,
    suggestion: 'If these sheets should reconcile, verify identifiers, dates, amounts, and spacing differences.',
    preview: [rowPreview(left, entry.rowIndex)]
  }));
};

export const makeSummaryFindings = (workbook: WorkbookModel, profile: WorkbookProfile): Finding[] => {
  const largestSheets = [...profile.sheets].sort((a, b) => b.rows - a.rows).slice(0, 3);
  return [
    {
      id: 'summary-workbook',
      type: 'summary',
      severity: 'info',
      title: 'Workbook summary',
      detail: `${workbook.fileName} has ${profile.sheetCount} sheet${profile.sheetCount === 1 ? '' : 's'}, ${profile.totalRows} data rows, and ${profile.totalColumns} detected columns.`,
      preview: largestSheets.map((sheet) => `${sheet.name}: ${sheet.rows} rows, ${sheet.columns} columns`)
    },
    {
      id: 'summary-relationships',
      type: 'relationship',
      severity: profile.relationshipHints.length ? 'info' : 'low',
      title: 'Cross-sheet relationship hints',
      detail: profile.relationshipHints.length
        ? `Detected ${profile.relationshipHints.length} possible cross-sheet link${profile.relationshipHints.length === 1 ? '' : 's'} based on shared column names or identifiers.`
        : 'No obvious cross-sheet relationships were detected from the headers yet.',
      preview: profile.relationshipHints.slice(0, 8).map((hint) => `${hint.leftSheet}.${hint.leftColumn} <-> ${hint.rightSheet}.${hint.rightColumn}`)
    }
  ];
};

export const cleanRows = (sheet: SheetData): CellValue[][] =>
  sheet.rows.map((row) =>
    row.map((cell) => {
      if (typeof cell !== 'string') return cell;
      const cleaned = cell.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const dateMatch = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        const fullYear = year.length === 2 ? `20${year}` : year;
        return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      if (/^-?[\d,]+(\.\d+)?$/.test(cleaned)) return Number(cleaned.replace(/,/g, ''));
      return cleaned;
    })
  );

export const createCleaningFindings = (workbook: WorkbookModel): Finding[] => {
  const findings: Finding[] = [];

  workbook.sheets.forEach((sheet) => {
    let changedCells = 0;
    sheet.rows.forEach((row) => {
      row.forEach((cell) => {
        if (typeof cell !== 'string') return;
        const cleaned = cell.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned !== cell) changedCells += 1;
      });
    });

    findings.push({
      id: `clean-${sheet.name}`,
      type: 'cleaning',
      severity: changedCells ? 'medium' : 'info',
      title: changedCells ? 'Cleaning changes available' : 'No basic whitespace cleanup needed',
      sheetName: sheet.name,
      detail: changedCells
        ? `${changedCells} cell${changedCells === 1 ? '' : 's'} can be cleaned by trimming spaces and normalizing repeated whitespace.`
        : `${sheet.name} looks clean under the basic whitespace checks.`,
      suggestion: changedCells ? 'Download the cleaned workbook and review before replacing the original file.' : undefined
    });
  });

  return findings;
};

export const buildCleanWorkbook = (workbook: WorkbookModel): XLSX.WorkBook => {
  const output = XLSX.utils.book_new();
  workbook.sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.aoa_to_sheet(cleanRows(sheet));
    XLSX.utils.book_append_sheet(output, worksheet, sheet.name.slice(0, 31));
  });
  return output;
};

export const cleanWorkbookToArrayBuffer = (workbook: WorkbookModel): ArrayBuffer =>
  XLSX.write(buildCleanWorkbook(workbook), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

export const downloadCleanWorkbook = (workbook: WorkbookModel): void => {
  const output = buildCleanWorkbook(workbook);
  const baseName = workbook.fileName.replace(/\.[^.]+$/, '');
  XLSX.writeFile(output, `${baseName || 'workbook'}_cleaned.xlsx`);
};

// As-is export: current cell values (including edits and translations), no cleaning.
export const buildWorkbookCopy = (workbook: WorkbookModel): XLSX.WorkBook => {
  const output = XLSX.utils.book_new();
  workbook.sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(output, worksheet, sheet.name.slice(0, 31));
  });
  return output;
};

export const workbookCopyToArrayBuffer = (workbook: WorkbookModel): ArrayBuffer =>
  XLSX.write(buildWorkbookCopy(workbook), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

export const downloadWorkbookCopy = (workbook: WorkbookModel): void => {
  const baseName = workbook.fileName.replace(/\.[^.]+$/, '');
  XLSX.writeFile(buildWorkbookCopy(workbook), `${baseName || 'workbook'}_copy.xlsx`);
};

export const toPreviewRows = (sheet: SheetData): CellValue[][] => sheet.rows.slice(0, MAX_PREVIEW_ROWS);
