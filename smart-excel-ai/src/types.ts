export type CellValue = string | number | boolean | Date | null;

export type SheetData = {
  name: string;
  rows: CellValue[][];
  headers: string[];
  headerRowIndex: number;
  dataStartIndex: number;
  rowCount: number;
  columnCount: number;
};

export type WorkbookModel = {
  fileName: string;
  importedAt: string;
  sheets: SheetData[];
};

export type ColumnProfile = {
  sheetName: string;
  header: string;
  index: number;
  nonEmptyCount: number;
  missingCount: number;
  inferredType: 'empty' | 'text' | 'number' | 'date' | 'currency' | 'email' | 'boolean' | 'mixed';
  examples: string[];
};

export type WorkbookProfile = {
  fileName: string;
  sheetCount: number;
  totalRows: number;
  totalColumns: number;
  sheets: Array<{
    name: string;
    rows: number;
    columns: number;
    headers: string[];
    columnsProfile: ColumnProfile[];
  }>;
  relationshipHints: Array<{
    leftSheet: string;
    leftColumn: string;
    rightSheet: string;
    rightColumn: string;
    reason: string;
  }>;
};

export type FindingSeverity = 'high' | 'medium' | 'low' | 'info';

export type Finding = {
  id: string;
  type: 'duplicate' | 'inconsistency' | 'missing' | 'search' | 'cleaning' | 'summary' | 'relationship';
  severity: FindingSeverity;
  title: string;
  sheetName?: string;
  rows?: number[];
  columns?: string[];
  detail: string;
  suggestion?: string;
  preview?: string[];
};

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  findings?: Finding[];
};

export type RuleDefinition = {
  id: string;
  name: string;
  matchColumn: string;
  contains: string[];
  category: string;
};

export type RuleResultRow = {
  rowNumber: number;
  category: string;
  matchedRuleId?: string;
  reviewFlags: string[];
  amount: number | null;
  values: Record<string, CellValue>;
};

export type RuleAnalysisResult = {
  sheetName: string;
  totalRows: number;
  categorizedRows: number;
  uncategorizedRows: number;
  invalidAmountRows: number;
  totalBefore: number;
  totalAfter: number;
  rows: RuleResultRow[];
};
