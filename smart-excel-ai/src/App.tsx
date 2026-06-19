import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Download,
  FilePlus2,
  FileSpreadsheet,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  MessageSquareText,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  UploadCloud,
  Wand2
} from 'lucide-react';
import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, useMemo, useRef, useState } from 'react';
import { askWorkbookAi, userMessage } from './lib/assistant';
import { pasteCells, updateCell } from './lib/grid-edit';
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
import type { AssistantMessage, Finding, FindingSeverity, SheetData, WorkbookModel } from './types';

type ActionKey = 'duplicates' | 'inconsistencies' | 'clean' | 'summary';

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

const createBlankWorkbook = (): WorkbookModel => {
  const columnCount = 26;
  const rowCount = 100;
  const headers = Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
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

  const profile = useMemo(() => (workbook ? buildWorkbookProfile(workbook) : null), [workbook]);
  const activeSheet = useMemo(
    () => workbook?.sheets.find((sheet) => sheet.name === activeSheetName) ?? workbook?.sheets[0] ?? null,
    [activeSheetName, workbook]
  );

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setError(null);
    setCleanReady(false);
    try {
      const parsed = await parseWorkbook(file);
      const nextProfile = buildWorkbookProfile(parsed);
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
    setWorkbook(blank);
    setActiveSheetName(blank.sheets[0].name);
    setFindings(makeSummaryFindings(blank, nextProfile));
    setCleanReady(false);
    setError(null);
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
    setWorkbook((current) => (current ? updateCell(current, sheetName, rowIndex, columnIndex, value) : current));
  };

  const pasteIntoCell = (sheetName: string, rowIndex: number, columnIndex: number, text: string) => {
    setCleanReady(false);
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
              <SheetSummary sheet={activeSheet} />
              <SheetPreview sheet={activeSheet} onEditCell={editCell} onPasteCells={pasteIntoCell} />
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

function SheetSummary({ sheet }: { sheet: SheetData }) {
  return (
    <div className="sheet-summary">
      <div>
        <span className="eyebrow">Active Sheet</span>
        <h2>{sheet.name}</h2>
      </div>
      <Stat label="Data rows" value={sheet.rowCount.toLocaleString()} />
      <Stat label="Columns" value={sheet.columnCount.toLocaleString()} />
      <Stat label="Header row" value={(sheet.headerRowIndex + 1).toLocaleString()} />
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
  const rows = sheet.rows.slice(sheet.dataStartIndex, sheet.dataStartIndex + 75);
  const headers = sheet.headers.slice(0, Math.max(1, sheet.columnCount));
  const focusCell = (rowIndex: number, columnIndex: number) => {
    const selector = `[data-cell="${sheet.name}-${rowIndex}-${columnIndex}"]`;
    const next = document.querySelector<HTMLInputElement>(selector);
    next?.focus();
    next?.select();
  };

  const moveFocus = (rowIndex: number, columnIndex: number, rowDelta: number, columnDelta: number) => {
    const nextRowIndex = Math.max(sheet.dataStartIndex, rowIndex + rowDelta);
    const nextColumnIndex = Math.max(0, columnIndex + columnDelta);
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
    } else if (event.key === 'ArrowRight' && event.currentTarget.selectionStart === event.currentTarget.value.length) {
      event.preventDefault();
      moveFocus(rowIndex, columnIndex, 0, 1);
    } else if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart === 0) {
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
    <div className="table-wrap">
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
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={`${sheet.name}-${rowIndex}`}>
                <td className="row-number">{sheet.dataStartIndex + rowIndex + 1}</td>
                {headers.map((_, columnIndex) => (
                  <td key={`${sheet.name}-${rowIndex}-${columnIndex}`}>
                    <input
                      aria-label={`${sheet.name} row ${sheet.dataStartIndex + rowIndex + 1} column ${columnIndex + 1}`}
                      className="grid-cell-input"
                      data-cell={`${sheet.name}-${sheet.dataStartIndex + rowIndex}-${columnIndex}`}
                      value={cellToText(row[columnIndex])}
                      onChange={(event) => onEditCell(sheet.name, sheet.dataStartIndex + rowIndex, columnIndex, event.target.value)}
                      onKeyDown={(event) => handleKeyDown(event, sheet.dataStartIndex + rowIndex, columnIndex)}
                      onPaste={(event) => handlePaste(event, sheet.dataStartIndex + rowIndex, columnIndex)}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length + 1}>No data rows detected.</td>
            </tr>
          )}
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
