// ── Custom function request / response types ──────────────────────────────

export interface ClassifyRequest {
  text: string;
  categories: string;
}
export interface ClassifyResponse {
  result: string;
  cached: boolean;
}

export interface ExtractRequest {
  text: string;
  field: string;
}
export interface ExtractResponse {
  result: string;
  cached: boolean;
}

export interface CleanRequest {
  text: string;
}
export interface CleanResponse {
  result: string;
  cached: boolean;
}

export interface MatchRequest {
  value: string;
  list: string;
}
export interface MatchResponse {
  result: string;
  cached: boolean;
}

export interface TranslateRequest {
  texts: string[];
  targetLanguage: string;
}
export interface TranslateResponse {
  translations: string[];
  cached: boolean;
}

export interface SummarizeRequest {
  texts: string[];
}
export interface SummarizeResponse {
  result: string;
  cached: boolean;
}

export interface AskRequest {
  prompt: string;
  context?: Record<string, unknown>;
}
export interface AskResponse {
  result: string;
  cached: boolean;
}

// ── Workbook Q&A (browser MVP Ask AI) ─────────────────────────────────────

export interface WorkbookAskRequest {
  question: string;
  workbookProfile?: Record<string, unknown>;
  visibleFindings?: unknown[];
  financialReport?: Record<string, unknown> | null;
}

export interface WorkbookAskResponse {
  answer: string;
  cached: boolean;
}

// ── Chat (sidebar assistant) ──────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  workbookContext?: WorkbookContext;
}

export interface ChatResponse {
  reply: string;
}

// ── Workbook context ──────────────────────────────────────────────────────

export interface WorkbookContext {
  activeSheet?: string;
  selection?: {
    address: string;
    values: unknown[][];
  };
  sheets?: WorkbookSheetContext[];
  profile?: WorkbookProfile;
  recentFindings?: AuditResult[];
}

export interface WorkbookSheetContext {
  name: string;
  address?: string;
  headers: string[];
  values: unknown[][];
  formulas?: string[][];
  rowCount: number;
  columnCount: number;
  truncated?: boolean;
}

export interface WorkbookProfile {
  sheetCount: number;
  totalRows: number;
  totalColumns: number;
  sheets: Array<{
    name: string;
    rows: number;
    columns: number;
    headers: string[];
  }>;
  relationshipHints: Array<{
    leftSheet: string;
    leftColumn: string;
    rightSheet: string;
    rightColumn: string;
    reason: string;
  }>;
}

// ── Audit ─────────────────────────────────────────────────────────────────

export type AuditSeverity = "error" | "warning" | "suggestion";

export interface AuditResult {
  id: string;
  severity: AuditSeverity;
  message: string;
  location?: string;
  dismissed?: boolean;
}

export interface AuditCheckRequest {
  sheetName: string;
  values: unknown[][];
  headers?: string[];
}

export interface AuditCheckResponse {
  results: AuditResult[];
}
