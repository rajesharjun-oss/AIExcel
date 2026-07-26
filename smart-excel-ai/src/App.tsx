import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Database,
  Download,
  FilePlus2,
  FileSpreadsheet,
  Languages,
  Layers3,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  MessageSquareText,
  RefreshCw,
  Scale,
  Search,
  Table2,
  TrendingUp,
  Undo2,
  UploadCloud,
  Wand2
} from 'lucide-react';
import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { askWorkbookAi, userMessage } from './lib/assistant';
import { analyzeWorkbookFinances, financialFindings, formatMoney } from './lib/finance';
import { pasteCells, updateCell } from './lib/grid-edit';
import {
  createTranslationFinding,
  languageLabel,
  supportedLanguages,
  translateSheet,
  type LanguageCode
} from './lib/translate';
import {
  buildWorkbookProfile,
  cellToText,
  createCleaningFindings,
  downloadCleanWorkbook,
  findDuplicates,
  findInconsistencies,
  makeSummaryFindings,
  parseWorkbook,
  searchWorkbook
} from './lib/workbook';
import type { AssistantMessage, FinancialReport, Finding, FindingSeverity, SheetData, WorkbookModel } from './types';

type ActionKey = 'duplicates' | 'inconsistencies' | 'clean' | 'summary';
type DataView = 'grid' | 'insights';

const severityLabels: Record<FindingSeverity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info'
};

const actionLabels: Record<ActionKey, string> = {
  duplicates: 'Find Duplicates',
  inconsistencies: 'Find Inconsistencies',
  clean: 'Clean Data',
  summary: 'Generate Summary'
};

const BLANK_WORKBOOK_COLUMNS = 52;
const BLANK_WORKBOOK_ROWS = 500;
const GRID_ROW_HEIGHT = 36;
const GRID_ROW_BUFFER = 8;

const excelColumnName = (index: number): string => {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
};

const createBlankWorkbook = (): WorkbookModel => {
  const columnCount = BLANK_WORKBOOK_COLUMNS;
  const rowCount = BLANK_WORKBOOK_ROWS;
  const headers = Array.from({ length: columnCount }, (_, index) => excelColumnName(index));
  return {
    fileName: 'Untitled workbook',
    importedAt: new Date().toISOString(),
    sheets: [
      {
        name: 'Sheet1',
        rows: [headers, ...Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => null))],
        headers,
        headerRowIndex: 0,
        dataStartIndex: 1,
        rowCount,
        columnCount
      }
    ]
  };
};

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [workbook, setWorkbook] = useState<WorkbookModel | null>(null);
  const [activeSheetName, setActiveSheetName] = useState<string>('');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const [cleanReady, setCleanReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetsCollapsed, setSheetsCollapsed] = useState(false);
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [dataView, setDataView] = useState<DataView>('grid');
  const [financialReport, setFinancialReport] = useState<FinancialReport | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>('es');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationBackup, setTranslationBackup] = useState<WorkbookModel | null>(null);

  const profile = useMemo(() => (workbook ? buildWorkbookProfile(workbook) : null), [workbook]);
  const activeSheet = useMemo(
    () => workbook?.sheets.find((sheet) => sheet.name === activeSheetName) ?? workbook?.sheets[0] ?? null,
    [activeSheetName, workbook]
  );

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setError(null);
    setCleanReady(false);
    setDataView('grid');
    setFinancialReport(null);
    try {
      const parsed = await parseWorkbook(file);
      const nextProfile = buildWorkbookProfile(parsed);
      setTranslationBackup(null);
      setWorkbook(parsed);
      setActiveSheetName(parsed.sheets[0]?.name ?? '');
      setFindings(makeSummaryFindings(parsed, nextProfile));
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          text: `Workbook indexed: ${nextProfile.sheetCount} sheet${nextProfile.sheetCount === 1 ? '' : 's'}, ${nextProfile.totalRows} data rows, ${nextProfile.relationshipHints.length} cross-sheet hint${nextProfile.relationshipHints.length === 1 ? '' : 's'}.`
        }
      ]);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Could not read this workbook.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const openBlankWorkbook = () => {
    const blank = createBlankWorkbook();
    const nextProfile = buildWorkbookProfile(blank);
    setTranslationBackup(null);
    setWorkbook(blank);
    setActiveSheetName(blank.sheets[0].name);
    setFindings(makeSummaryFindings(blank, nextProfile));
    setCleanReady(false);
    setError(null);
    setDataView('grid');
    setFinancialReport(null);
    setMessages([
      {
        id: 'blank-workbook',
        role: 'assistant',
        text: 'Blank workbook created. You can type, paste, upload a file, run checks, or ask AI about the sheet.'
      }
    ]);
  };

  const editCell = (sheetName: string, rowIndex: number, columnIndex: number, value: string) => {
    setCleanReady(false);
    // Manual edits invalidate the translation snapshot so Revert can never discard them.
    setTranslationBackup(null);
    setWorkbook((current) => (current ? updateCell(current, sheetName, rowIndex, columnIndex, value) : current));
  };

  const pasteIntoCell = (sheetName: string, rowIndex: number, columnIndex: number, text: string) => {
    setCleanReady(false);
    setTranslationBackup(null);
    setWorkbook((current) => (current ? pasteCells(current, sheetName, rowIndex, columnIndex, text) : current));
  };

  const runAction = (action: ActionKey) => {
    if (!workbook || !profile) return;
    setActiveAction(action);
    setCleanReady(action === 'clean');

    const nextFindings =
      action === 'duplicates'
        ? findDuplicates(workbook)
        : action === 'inconsistencies'
          ? findInconsistencies(workbook)
          : action === 'clean'
            ? createCleaningFindings(workbook)
            : makeSummaryFindings(workbook, profile);

    setFindings(nextFindings);
    setMessages((current) => [
      ...current,
      {
        id: `${action}-${Date.now()}`,
        role: 'assistant',
        text: `${actionLabels[action]} completed. ${nextFindings.length ? `${nextFindings.length} finding${nextFindings.length === 1 ? '' : 's'} returned.` : 'No findings returned.'}`,
        findings: nextFindings
      }
    ]);

    window.setTimeout(() => setActiveAction(null), 300);
  };

  const runSearch = () => {
    if (!workbook || !searchTerm.trim()) return;
    const results = searchWorkbook(workbook, searchTerm);
    setFindings(results);
    setMessages((current) => [
      ...current,
      {
        id: `search-${Date.now()}`,
        role: 'assistant',
        text: results.length
          ? `Found ${results.length} matching row${results.length === 1 ? '' : 's'} across the workbook.`
          : 'No matching rows found across the workbook.',
        findings: results
      }
    ]);
  };

  const runInsights = () => {
    if (!workbook) return;
    const report = analyzeWorkbookFinances(workbook, activeSheet?.name);
    setFinancialReport(report);
    setDataView('insights');
    if (report) {
      const nextFindings = financialFindings(report);
      setFindings(nextFindings);
      setMessages((current) => [
        ...current,
        {
          id: `insights-${Date.now()}`,
          role: 'assistant',
          text: `Financial insights ready for ${report.sheetName}: net ${formatMoney(report.net, report.currencySymbol)} across ${report.transactionCount} transactions.`,
          findings: nextFindings
        }
      ]);
    } else {
      setMessages((current) => [
        ...current,
        {
          id: `insights-${Date.now()}`,
          role: 'assistant',
          text: 'No amount or debit/credit column was detected, so financial insights are unavailable. Add or rename an amount column and try again.'
        }
      ]);
    }
  };

  const runTranslation = async () => {
    if (!workbook || !activeSheet || isTranslating) return;
    setIsTranslating(true);
    const backup = translationBackup ?? workbook;
    try {
      const result = await translateSheet(workbook, activeSheet.name, targetLanguage);
      const finding = createTranslationFinding(result);
      if (result.translatedCells) {
        setTranslationBackup(backup);
        setWorkbook(result.workbook);
        setCleanReady(false);
      }
      setFindings([finding]);
      setMessages((current) => [
        ...current,
        {
          id: `translate-${Date.now()}`,
          role: 'assistant',
          text: result.translatedCells
            ? `Translated ${result.translatedCells} cell${result.translatedCells === 1 ? '' : 's'} on ${result.sheetName} to ${languageLabel(result.targetLanguage)}${result.usedRemoteAi ? ' with the AI translation service' : ' with the built-in dictionary'}. Numbers, dates, and IDs were preserved.`
            : `No translatable text was found on ${result.sheetName} for ${languageLabel(result.targetLanguage)}.`,
          findings: [finding]
        }
      ]);
    } finally {
      setIsTranslating(false);
    }
  };

  const revertTranslation = () => {
    if (!translationBackup) return;
    setWorkbook(translationBackup);
    setTranslationBackup(null);
    setCleanReady(false);
    setMessages((current) => [
      ...current,
      {
        id: `translate-revert-${Date.now()}`,
        role: 'assistant',
        text: 'Translation reverted. The original workbook text has been restored.'
      }
    ]);
  };

  const askAi = async (event: FormEvent) => {
    event.preventDefault();
    if (!workbook || !question.trim()) return;
    const text = question.trim();
    setQuestion('');
    setIsThinking(true);
    setMessages((current) => [...current, userMessage(text)]);
    const response = await askWorkbookAi(text, workbook, findings);
    setMessages((current) => [...current, response]);
    if (response.findings) setFindings(response.findings);
    setIsThinking(false);
  };

  return (
    <main className="app-shell">
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        onChange={handleFileInput}
      />

      <header className="topbar">
        <div className="brand-mark">
          <FileSpreadsheet size={22} />
        </div>
        <div>
          <h1>Smart Excel AI</h1>
          <p>{workbook ? workbook.fileName : 'Workbook task assistant'}</p>
        </div>
        <div className="topbar-actions">
          {profile ? <Stat label="Sheets" value={profile.sheetCount.toLocaleString()} /> : null}
          {profile ? <Stat label="Rows" value={profile.totalRows.toLocaleString()} /> : null}
          <button className="button" type="button" onClick={openBlankWorkbook}>
            <FilePlus2 size={17} />
            New Workbook
          </button>
          <button className="button primary" type="button" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={17} />
            Upload
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-strip">
          <AlertTriangle size={18} />
          {error}
        </div>
      ) : null}

      <section className="action-strip">
        <button className="button" type="button" disabled={!workbook} onClick={() => runAction('duplicates')}>
          {activeAction === 'duplicates' ? <RefreshCw className="spin" size={17} /> : <Layers3 size={17} />}
          Find Duplicates
        </button>
        <button className="button" type="button" disabled={!workbook} onClick={() => runAction('inconsistencies')}>
          {activeAction === 'inconsistencies' ? <RefreshCw className="spin" size={17} /> : <AlertTriangle size={17} />}
          Find Inconsistencies
        </button>
        <button className="button" type="button" disabled={!workbook} onClick={() => runAction('clean')}>
          {activeAction === 'clean' ? <RefreshCw className="spin" size={17} /> : <Wand2 size={17} />}
          Clean Data
        </button>
        <button className="button" type="button" disabled={!workbook} onClick={() => runAction('summary')}>
          {activeAction === 'summary' ? <RefreshCw className="spin" size={17} /> : <Database size={17} />}
          Summary
        </button>
        <button className="button emerald" type="button" disabled={!workbook} onClick={runInsights}>
          <LineChart size={17} />
          Financial Insights
        </button>
        <div className="translate-box">
          <Languages size={17} />
          <select
            aria-label="Target language"
            value={targetLanguage}
            onChange={(event) => setTargetLanguage(event.target.value as LanguageCode)}
            disabled={!workbook || isTranslating}
          >
            {supportedLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void runTranslation()} disabled={!workbook || isTranslating}>
            {isTranslating ? <RefreshCw className="spin" size={15} /> : null}
            Translate
          </button>
          {translationBackup ? (
            <button type="button" title="Revert translation" onClick={revertTranslation} disabled={isTranslating}>
              <Undo2 size={15} />
              Revert
            </button>
          ) : null}
        </div>
        <div className="search-box">
          <Search size={17} />
          <input
            value={searchTerm}
            placeholder="Search all sheets"
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
            }}
            disabled={!workbook}
          />
          <button type="button" onClick={runSearch} disabled={!workbook || !searchTerm.trim()}>
            Search
          </button>
        </div>
        <button className="button accent" type="button" disabled={!workbook || !cleanReady} onClick={() => workbook && downloadCleanWorkbook(workbook)}>
          <Download size={17} />
          Download Cleaned
        </button>
      </section>

      <section className={`workspace-grid ${sheetsCollapsed ? 'sheets-collapsed' : ''} ${assistantCollapsed ? 'assistant-collapsed' : ''}`}>
        <aside className={`sheet-rail ${sheetsCollapsed ? 'collapsed' : ''}`}>
          <div className="rail-heading rail-heading-row">
            <span>
              <Table2 size={17} />
              Sheets
            </span>
            <button className="icon-button" type="button" title={sheetsCollapsed ? 'Show sheets' : 'Hide sheets'} onClick={() => setSheetsCollapsed((value) => !value)}>
              {sheetsCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          {sheetsCollapsed ? null : (
            <>
          {workbook ? (
            workbook.sheets.map((sheet) => (
              <button
                className={`sheet-tab ${sheet.name === activeSheet?.name ? 'active' : ''}`}
                key={sheet.name}
                type="button"
                onClick={() => setActiveSheetName(sheet.name)}
              >
                <span>{sheet.name}</span>
                <small>{sheet.rowCount.toLocaleString()} rows</small>
              </button>
            ))
          ) : (
            <div className="muted-block">No workbook loaded</div>
          )}
            </>
          )}
        </aside>

        <section className="data-pane">
          {workbook && activeSheet ? (
            <>
              <SheetSummary
                sheet={activeSheet}
                view={dataView}
                onViewChange={(view) => {
                  if (view === 'insights') runInsights();
                  else setDataView('grid');
                }}
              />
              {dataView === 'insights' ? (
                <InsightsPanel report={financialReport} />
              ) : (
                <SheetPreview sheet={activeSheet} onEditCell={editCell} onPasteCells={pasteIntoCell} />
              )}
            </>
          ) : (
            <UploadPanel isParsing={isParsing} onDrop={handleDrop} onBrowse={() => fileInputRef.current?.click()} onNewWorkbook={openBlankWorkbook} />
          )}
        </section>

        <aside className={`assistant-pane ${assistantCollapsed ? 'collapsed' : ''}`}>
          <div className="assistant-header">
            <div>
              <div className="rail-heading">
                <Bot size={17} />
                Ask AI
              </div>
              <p>{workbook ? 'Workbook-aware tasks' : 'Upload a workbook to begin'}</p>
            </div>
            <button className="icon-button" type="button" title={assistantCollapsed ? 'Show AI panel' : 'Hide AI panel'} onClick={() => setAssistantCollapsed((value) => !value)}>
              {assistantCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
            </button>
          </div>
          {assistantCollapsed ? null : (
            <>

          <div className="messages">
            {messages.length ? (
              messages.map((message) => (
                <div className={`message ${message.role}`} key={message.id}>
                  <span>{message.role === 'user' ? 'You' : 'AI'}</span>
                  <p>{message.text}</p>
                </div>
              ))
            ) : (
              <div className="message assistant">
                <span>AI</span>
                <p>Workbook context will appear here.</p>
              </div>
            )}
            {isThinking ? (
              <div className="message assistant">
                <span>AI</span>
                <p>Thinking through the workbook...</p>
              </div>
            ) : null}
          </div>

          <form className="ask-form" onSubmit={askAi}>
            <MessageSquareText size={18} />
            <input
              value={question}
              placeholder="Ask across sheets"
              onChange={(event) => setQuestion(event.target.value)}
              disabled={!workbook || isThinking}
            />
            <button type="submit" disabled={!workbook || !question.trim() || isThinking}>
              Ask
            </button>
          </form>

          <FindingList findings={findings} />
            </>
          )}
        </aside>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function UploadPanel({
  isParsing,
  onBrowse,
  onDrop,
  onNewWorkbook
}: {
  isParsing: boolean;
  onBrowse: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onNewWorkbook: () => void;
}) {
  return (
    <div className="upload-panel" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div className="upload-icon">
        {isParsing ? <RefreshCw className="spin" size={34} /> : <UploadCloud size={34} />}
      </div>
      <h2>{isParsing ? 'Indexing workbook' : 'Load an Excel workbook'}</h2>
      <p>.xlsx, .xls, .xlsm, and .csv files</p>
      <div className="upload-actions">
        <button className="button primary" type="button" onClick={onNewWorkbook} disabled={isParsing}>
          <FilePlus2 size={17} />
          New Workbook
        </button>
        <button className="button" type="button" onClick={onBrowse} disabled={isParsing}>
          <UploadCloud size={17} />
          Upload Excel
        </button>
      </div>
    </div>
  );
}

function SheetSummary({
  sheet,
  view,
  onViewChange
}: {
  sheet: SheetData;
  view: DataView;
  onViewChange: (view: DataView) => void;
}) {
  return (
    <div className="sheet-summary">
      <div>
        <span className="eyebrow">Active Sheet</span>
        <h2>{sheet.name}</h2>
      </div>
      <Stat label="Data rows" value={sheet.rowCount.toLocaleString()} />
      <Stat label="Columns" value={sheet.columnCount.toLocaleString()} />
      <Stat label="Header row" value={(sheet.headerRowIndex + 1).toLocaleString()} />
      <div className="view-toggle" role="tablist" aria-label="Data view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'grid'}
          className={view === 'grid' ? 'active' : ''}
          onClick={() => onViewChange('grid')}
        >
          <Table2 size={15} />
          Grid
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'insights'}
          className={view === 'insights' ? 'active' : ''}
          onClick={() => onViewChange('insights')}
        >
          <LineChart size={15} />
          Insights
        </button>
      </div>
    </div>
  );
}

function InsightsPanel({ report }: { report: FinancialReport | null }) {
  if (!report) {
    return (
      <div className="muted-block">
        No financial columns detected. Add or rename an amount (or debit/credit) column, then run Financial Insights.
      </div>
    );
  }

  const symbol = report.currencySymbol;
  const netPositive = report.net >= 0;
  const categoryScale = Math.max(1, ...report.categories.map((category) => Math.abs(category.total)));
  const monthlyScale = Math.max(1, ...report.monthly.map((month) => Math.max(month.inflow, month.outflow)));

  return (
    <div className="insights-panel">
      <div className="kpi-row">
        <Kpi tone="inflow" icon={<ArrowUpRight size={16} />} label="Total inflow" value={formatMoney(report.totalInflow, symbol)} />
        <Kpi tone="outflow" icon={<ArrowDownRight size={16} />} label="Total outflow" value={formatMoney(report.totalOutflow, symbol)} />
        <Kpi tone={netPositive ? 'inflow' : 'outflow'} icon={<Scale size={16} />} label="Net position" value={formatMoney(report.net, symbol)} />
        <Kpi tone="neutral" icon={<TrendingUp size={16} />} label="Transactions" value={report.transactionCount.toLocaleString()} sub={`Avg ${formatMoney(report.averageAmount, symbol)}`} />
      </div>

      <div className="insights-columns">
        <section className="insights-card">
          <div className="rail-heading">
            <Layers3 size={16} />
            Top {report.groupedBy.toLowerCase()} by value
          </div>
          {report.categories.length ? (
            <div className="bar-list">
              {report.categories.slice(0, 8).map((category) => (
                <div className="bar-row" key={category.label}>
                  <div className="bar-label" title={category.label}>
                    <span>{category.label}</span>
                    <strong className={category.total < 0 ? 'negative' : 'positive'}>{formatMoney(category.total, symbol)}</strong>
                  </div>
                  <div className="bar-track">
                    <div
                      className={`bar-fill ${category.total < 0 ? 'outflow' : 'inflow'}`}
                      style={{ width: `${Math.max(3, (Math.abs(category.total) / categoryScale) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted-inline">No groupable values found.</div>
          )}
        </section>

        <section className="insights-card">
          <div className="rail-heading">
            <LineChart size={16} />
            Monthly cashflow
          </div>
          {report.monthly.length ? (
            <div className="month-list">
              {report.monthly.map((month) => (
                <div className="month-row" key={month.month}>
                  <span className="month-label">{month.label}</span>
                  <div className="month-bars">
                    <div className="month-bar inflow" style={{ width: `${(month.inflow / monthlyScale) * 100}%` }} title={`Inflow ${formatMoney(month.inflow, symbol)}`} />
                    <div className="month-bar outflow" style={{ width: `${(month.outflow / monthlyScale) * 100}%` }} title={`Outflow ${formatMoney(month.outflow, symbol)}`} />
                  </div>
                  <strong className={month.net < 0 ? 'negative' : 'positive'}>{formatMoney(month.net, symbol)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted-inline">No date column detected for a monthly trend.</div>
          )}
        </section>
      </div>

      {report.anomalies.length ? (
        <section className="insights-card">
          <div className="rail-heading">
            <AlertTriangle size={16} />
            {report.anomalies.length} unusual amount{report.anomalies.length === 1 ? '' : 's'}
          </div>
          <div className="anomaly-list">
            {report.anomalies.slice(0, 8).map((anomaly) => (
              <div className="anomaly-row" key={`${anomaly.rowNumber}-${anomaly.amount}`}>
                <span className="anomaly-amount">{formatMoney(anomaly.amount, symbol)}</span>
                <span className="anomaly-desc" title={anomaly.description}>{anomaly.description}</span>
                <small>Row {anomaly.rowNumber}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Kpi({
  tone,
  icon,
  label,
  value,
  sub
}: {
  tone: 'inflow' | 'outflow' | 'neutral';
  icon: JSX.Element;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <span className="kpi-icon">{icon}</span>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {sub ? <small className="kpi-sub">{sub}</small> : null}
    </div>
  );
}

function SheetPreview({
  sheet,
  onEditCell,
  onPasteCells
}: {
  sheet: SheetData;
  onEditCell: (sheetName: string, rowIndex: number, columnIndex: number, value: string) => void;
  onPasteCells: (sheetName: string, rowIndex: number, columnIndex: number, text: string) => void;
}) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: 540 });
  const [pendingFocus, setPendingFocus] = useState<{ rowIndex: number; columnIndex: number } | null>(null);
  const headers = sheet.headers.slice(0, Math.max(1, sheet.columnCount));
  const dataRows = useMemo(() => sheet.rows.slice(sheet.dataStartIndex), [sheet.dataStartIndex, sheet.rows]);
  const visibleCount = Math.max(20, Math.ceil(viewport.clientHeight / GRID_ROW_HEIGHT) + GRID_ROW_BUFFER * 2);
  const startRowOffset = Math.max(0, Math.floor(viewport.scrollTop / GRID_ROW_HEIGHT) - GRID_ROW_BUFFER);
  const endRowOffset = Math.min(dataRows.length, startRowOffset + visibleCount);
  const rows = dataRows.slice(startRowOffset, endRowOffset);
  const topSpacerHeight = startRowOffset * GRID_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (dataRows.length - endRowOffset) * GRID_ROW_HEIGHT);

  useEffect(() => {
    const wrapper = tableWrapRef.current;
    if (!wrapper) return;
    wrapper.scrollTop = 0;
    wrapper.scrollLeft = 0;
    setViewport({ scrollTop: wrapper.scrollTop, clientHeight: wrapper.clientHeight || 540 });
  }, [sheet.name, sheet.rowCount, sheet.columnCount]);

  useEffect(() => {
    if (!pendingFocus) return;
    const selector = `[data-cell="${sheet.name}-${pendingFocus.rowIndex}-${pendingFocus.columnIndex}"]`;
    const next = document.querySelector<HTMLInputElement>(selector);
    if (!next) return;
    next.focus();
    next.select();
    setPendingFocus(null);
  }, [pendingFocus, rows, sheet.name]);

  const updateViewport = () => {
    const wrapper = tableWrapRef.current;
    if (!wrapper) return;
    setViewport({ scrollTop: wrapper.scrollTop, clientHeight: wrapper.clientHeight || 540 });
  };

  const focusCell = (rowIndex: number, columnIndex: number) => {
    const selector = `[data-cell="${sheet.name}-${rowIndex}-${columnIndex}"]`;
    const next = document.querySelector<HTMLInputElement>(selector);
    const scroller = tableWrapRef.current ?? next?.closest<HTMLElement>('.table-wrap');
    const dataRowOffset = rowIndex - sheet.dataStartIndex;
    if (!next && scroller && dataRowOffset >= 0) {
      scroller.scrollTop = Math.max(0, dataRowOffset * GRID_ROW_HEIGHT - GRID_ROW_HEIGHT * 2);
      setViewport({ scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight || viewport.clientHeight });
      setPendingFocus({ rowIndex, columnIndex });
      return;
    }
    if (next && scroller) {
      const cellRect = next.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      if (cellRect.right > scrollerRect.right) {
        scroller.scrollLeft += cellRect.right - scrollerRect.right + 12;
      } else if (cellRect.left < scrollerRect.left) {
        scroller.scrollLeft -= scrollerRect.left - cellRect.left + 12;
      }
      if (cellRect.bottom > scrollerRect.bottom) {
        scroller.scrollTop += cellRect.bottom - scrollerRect.bottom + 12;
      } else if (cellRect.top < scrollerRect.top) {
        scroller.scrollTop -= scrollerRect.top - cellRect.top + 12;
      }
    }
    next?.focus();
    next?.select();
  };

  const moveFocus = (rowIndex: number, columnIndex: number, rowDelta: number, columnDelta: number) => {
    const lastRowIndex = Math.max(sheet.dataStartIndex, sheet.rows.length - 1);
    const lastColumnIndex = Math.max(0, headers.length - 1);
    const nextRowIndex = Math.min(lastRowIndex, Math.max(sheet.dataStartIndex, rowIndex + rowDelta));
    const nextColumnIndex = Math.min(lastColumnIndex, Math.max(0, columnIndex + columnDelta));
    window.requestAnimationFrame(() => focusCell(nextRowIndex, nextColumnIndex));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    if (event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(rowIndex, columnIndex, 1, 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(rowIndex, columnIndex, -1, 0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveFocus(rowIndex, columnIndex, 0, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFocus(rowIndex, columnIndex, 0, -1);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      moveFocus(rowIndex, columnIndex, event.shiftKey ? 0 : 0, event.shiftKey ? -1 : 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !/[\r\n]/.test(text)) return;
    event.preventDefault();
    onPasteCells(sheet.name, rowIndex, columnIndex, text);
    window.requestAnimationFrame(() => focusCell(rowIndex, columnIndex));
  };

  return (
    <div className="table-wrap" ref={tableWrapRef} onScroll={updateViewport}>
      <table>
        <thead>
          <tr>
            <th className="row-number">#</th>
            {headers.map((header, index) => (
              <th key={`${header}-${index}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topSpacerHeight > 0 ? (
            <tr className="virtual-spacer" aria-hidden="true">
              <td colSpan={headers.length + 1} style={{ height: topSpacerHeight }} />
            </tr>
          ) : null}
          {dataRows.length ? (
            rows.map((row, rowIndex) => {
              const dataRowOffset = startRowOffset + rowIndex;
              const sheetRowIndex = sheet.dataStartIndex + dataRowOffset;
              return (
              <tr key={`${sheet.name}-${sheetRowIndex}`}>
                <td className="row-number">{dataRowOffset + 1}</td>
                {headers.map((_, columnIndex) => (
                  <td key={`${sheet.name}-${sheetRowIndex}-${columnIndex}`}>
                    <input
                      aria-label={`${sheet.name} row ${dataRowOffset + 1} column ${columnIndex + 1}`}
                      className="grid-cell-input"
                      data-cell={`${sheet.name}-${sheetRowIndex}-${columnIndex}`}
                      value={cellToText(row[columnIndex])}
                      onChange={(event) => onEditCell(sheet.name, sheetRowIndex, columnIndex, event.target.value)}
                      onKeyDown={(event) => handleKeyDown(event, sheetRowIndex, columnIndex)}
                      onPaste={(event) => handlePaste(event, sheetRowIndex, columnIndex)}
                    />
                  </td>
                ))}
              </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={headers.length + 1}>No data rows detected.</td>
            </tr>
          )}
          {bottomSpacerHeight > 0 ? (
            <tr className="virtual-spacer" aria-hidden="true">
              <td colSpan={headers.length + 1} style={{ height: bottomSpacerHeight }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <div className="findings">
      <div className="rail-heading">
        <CheckCircle2 size={17} />
        Findings
      </div>
      {findings.length ? (
        findings.map((finding) => (
          <article className="finding-card" key={finding.id}>
            <div className="finding-topline">
              <span className={`severity ${finding.severity}`}>{severityLabels[finding.severity]}</span>
              {finding.sheetName ? <small>{finding.sheetName}</small> : null}
            </div>
            <h3>{finding.title}</h3>
            <p>{finding.detail}</p>
            {finding.preview?.length ? (
              <div className="preview-list">
                {finding.preview.map((line, index) => (
                  <span key={`${finding.id}-${index}`}>{line}</span>
                ))}
              </div>
            ) : null}
            {finding.suggestion ? <p className="suggestion">{finding.suggestion}</p> : null}
          </article>
        ))
      ) : (
        <div className="muted-block">No findings yet</div>
      )}
    </div>
  );
}

export default App;
