import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Body1,
  Button,
  Field,
  Spinner,
  Textarea,
  Title2,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { runAiAudit } from "../audit/ai-checks";
import { post } from "../shared/api-client";
import {
  findCleaningOpportunities,
  findDuplicateRows,
  findWorkbookInconsistencies,
  formatFindingsForChat,
  searchWorkbook,
  summarizeWorkbook,
} from "../shared/workbook-analysis";
import { cleanSelectedRange, getWorkbookWideContext } from "../shared/workbook";
import type { AuditResult, ChatMessage, ChatRequest, ChatResponse, WorkbookContext } from "@aiexcel/shared";

type ToolName = "index" | "duplicates" | "inconsistencies" | "clean" | "audit" | "search";

const useStyles = makeStyles({
  root: {
    display: "grid",
    gridTemplateRows: "auto auto auto minmax(130px, 0.8fr) minmax(180px, 1fr) auto",
    gap: "10px",
    height: "100vh",
    boxSizing: "border-box",
    padding: "14px",
    color: "#231f18",
    backgroundColor: "#f4efe4",
    backgroundImage:
      "linear-gradient(135deg, rgba(184, 139, 64, 0.14), rgba(255, 255, 255, 0) 36%), linear-gradient(180deg, #fbf8f0 0%, #f0e8d9 100%)",
    fontFamily: "Aptos, 'Segoe UI', sans-serif",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    border: "1px solid rgba(56, 46, 31, 0.18)",
    borderRadius: "8px",
    padding: "14px",
    color: "#f9f2df",
    background:
      "linear-gradient(135deg, #15120d 0%, #2f281b 56%, #5b4425 100%)",
    boxShadow: "0 18px 45px rgba(35, 31, 24, 0.18)",
  },
  muted: {
    color: "rgba(249, 242, 223, 0.76)",
    fontSize: tokens.fontSizeBase200,
  },
  eyebrow: {
    color: "#d6b56d",
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
  },
  stat: {
    border: "1px solid rgba(91, 68, 37, 0.18)",
    borderRadius: "7px",
    backgroundColor: "rgba(255, 252, 244, 0.86)",
    padding: "10px",
    minHeight: "58px",
    boxShadow: "0 12px 28px rgba(52, 42, 26, 0.08)",
  },
  statLabel: {
    color: "#75674f",
    fontSize: tokens.fontSizeBase100,
    textTransform: "uppercase",
  },
  statValue: {
    display: "block",
    marginTop: "5px",
    color: "#1f1b14",
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tools: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "8px",
  },
  searchRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "8px",
  },
  input: {
    border: "1px solid rgba(91, 68, 37, 0.24)",
    borderRadius: "6px",
    padding: "0 11px",
    minHeight: "36px",
    minWidth: 0,
    color: "#201b13",
    backgroundColor: "rgba(255, 253, 247, 0.92)",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
  },
  panel: {
    border: "1px solid rgba(91, 68, 37, 0.16)",
    borderRadius: "8px",
    backgroundColor: "rgba(255, 253, 247, 0.9)",
    overflowY: "auto",
    padding: "11px",
    boxShadow: "0 14px 34px rgba(52, 42, 26, 0.08)",
  },
  findings: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  finding: {
    border: "1px solid rgba(91, 68, 37, 0.14)",
    borderLeft: "4px solid #9b7330",
    borderRadius: "6px",
    backgroundColor: "#fbf7ed",
    padding: "10px",
  },
  findingTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    marginBottom: "3px",
    color: "#74664d",
    fontSize: tokens.fontSizeBase100,
    textTransform: "uppercase",
  },
  messages: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  bubble: {
    border: "1px solid rgba(91, 68, 37, 0.12)",
    borderRadius: "7px",
    padding: "10px",
    color: "#282218",
    backgroundColor: "#f7f0e4",
    whiteSpace: "pre-wrap",
    boxShadow: "0 8px 20px rgba(52, 42, 26, 0.06)",
  },
  userBubble: {
    border: "1px solid rgba(15, 77, 64, 0.24)",
    backgroundColor: "#e9f1ea",
    alignSelf: "flex-end",
    maxWidth: "88%",
  },
  inputRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  status: {
    minHeight: "18px",
    color: "#6b5e47",
    fontSize: tokens.fontSizeBase200,
    marginBottom: "8px",
  },
  primaryButton: {
    borderRadius: "6px",
    border: "1px solid #1e4d40",
    color: "#fff",
    backgroundColor: "#1e4d40",
    boxShadow: "0 10px 20px rgba(30, 77, 64, 0.18)",
  },
  secondaryButton: {
    borderRadius: "6px",
    border: "1px solid rgba(91, 68, 37, 0.22)",
    color: "#2b2418",
    backgroundColor: "rgba(255, 253, 247, 0.95)",
  },
  goldButton: {
    borderRadius: "6px",
    border: "1px solid #9b7330",
    color: "#241b0f",
    background: "linear-gradient(180deg, #f5dc9a 0%, #d1a84f 100%)",
    fontWeight: tokens.fontWeightSemibold,
  },
  sectionLabel: {
    display: "block",
    marginBottom: "7px",
    color: "#6f5932",
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
  },
});

export const App: React.FC = () => {
  const styles = useStyles();
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [toolLoading, setToolLoading] = useState<ToolName | null>(null);
  const [status, setStatus] = useState("Open a workbook and index it to begin.");
  const [workbookContext, setWorkbookContext] = useState<WorkbookContext | undefined>();
  const [findings, setFindings] = useState<AuditResult[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const profile = workbookContext?.profile;
  const activeSheet = workbookContext?.activeSheet ?? "No sheet";

  const findingSummary = useMemo(() => {
    const counts = findings.reduce<Record<string, number>>((acc, item) => {
      acc[item.severity] = (acc[item.severity] ?? 0) + 1;
      return acc;
    }, {});
    return `${counts.error ?? 0} errors, ${counts.warning ?? 0} warnings, ${counts.suggestion ?? 0} suggestions`;
  }, [findings]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  const refreshContext = async () => {
    const context = await getWorkbookWideContext();
    setWorkbookContext(context);
    return context;
  };

  const withContext = async (tool: ToolName, action: (context: WorkbookContext) => Promise<void> | void) => {
    setToolLoading(tool);
    try {
      const context = workbookContext ?? (await refreshContext());
      await action(context);
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setToolLoading(null);
    }
  };

  const indexWorkbook = () =>
    withContext("index", async () => {
      const context = await refreshContext();
      const results = summarizeWorkbook(context);
      setFindings(results);
      setStatus(
        `Indexed ${context.profile?.sheetCount ?? 0} sheets and ${context.profile?.totalRows ?? 0} used rows.`
      );
    });

  const runDuplicates = () =>
    withContext("duplicates", (context) => {
      const results = findDuplicateRows(context);
      setFindings(results);
      setStatus(results.length ? `Found ${results.length} duplicate group${results.length === 1 ? "" : "s"}.` : "No duplicate rows found.");
    });

  const runInconsistencies = () =>
    withContext("inconsistencies", (context) => {
      const results = findWorkbookInconsistencies(context);
      setFindings(results);
      setStatus(results.length ? `Found ${results.length} workbook issue${results.length === 1 ? "" : "s"}.` : "No workbook inconsistencies found.");
    });

  const runCleaning = () =>
    withContext("clean", async (context) => {
      const opportunities = findCleaningOpportunities(context);
      const result = await cleanSelectedRange();
      const refreshed = await refreshContext();
      const applied: AuditResult = {
        id: `clean-${Date.now()}`,
        severity: result.changedCells ? "warning" : "suggestion",
        message: result.changedCells
          ? `Cleaned ${result.changedCells} selected cell${result.changedCells === 1 ? "" : "s"} by trimming and normalising spaces.`
          : "Selected range did not need whitespace cleanup.",
        location: result.address,
      };
      setFindings([applied, ...opportunities]);
      setStatus(`Clean selection completed on ${result.address}. Snapshot now covers ${refreshed.profile?.sheetCount ?? 0} sheets.`);
    });

  const runAudit = () =>
    withContext("audit", async () => {
      const results = await runAiAudit();
      setFindings(results);
      setStatus(results.length ? `AI audit returned ${results.length} active-sheet finding${results.length === 1 ? "" : "s"}.` : "AI audit returned no findings.");
    });

  const runSearch = () =>
    withContext("search", (context) => {
      const results = searchWorkbook(context, searchTerm);
      setFindings(results);
      setStatus(results.length ? `Found ${results.length} matching row${results.length === 1 ? "" : "s"}.` : "No matching rows found.");
    });

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const newHistory: ChatMessage[] = [...history, { role: "user", content: text }];
    setHistory(newHistory);
    setInput("");
    setLoading(true);

    try {
      const context = workbookContext ?? (await refreshContext());
      const body: ChatRequest = {
        messages: newHistory,
        workbookContext: {
          ...context,
          recentFindings: findings.slice(0, 30),
        },
      };
      const { reply } = await post<ChatResponse>("/v1/chat", body);
      setHistory((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      const context = workbookContext;
      const local = context ? localAnswer(text, context) : "I could not reach the backend, and workbook context is not loaded yet.";
      setHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Backend unavailable, so I used local workbook tools.\n\n${local}\n\nError detail: ${String(err)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Private workbook intelligence</span>
        <Title2>AIExcel Assistant</Title2>
        <span className={styles.muted}>Active sheet: {activeSheet}</span>
      </div>

      <div className={styles.stats}>
        <Stat label="Sheets" value={String(profile?.sheetCount ?? 0)} styles={styles} />
        <Stat label="Rows" value={String(profile?.totalRows ?? 0)} styles={styles} />
        <Stat label="Findings" value={findingSummary} styles={styles} />
      </div>

      <div>
        <span className={styles.sectionLabel}>Command suite</span>
        <div className={styles.tools}>
          <ToolButton label="Index Workbook" name="index" loading={toolLoading} onClick={indexWorkbook} className={styles.goldButton} />
          <ToolButton label="Find Duplicates" name="duplicates" loading={toolLoading} onClick={runDuplicates} className={styles.secondaryButton} />
          <ToolButton label="Find Issues" name="inconsistencies" loading={toolLoading} onClick={runInconsistencies} className={styles.secondaryButton} />
          <ToolButton label="Clean Selection" name="clean" loading={toolLoading} onClick={runCleaning} className={styles.secondaryButton} />
          <ToolButton label="AI Audit Sheet" name="audit" loading={toolLoading} onClick={runAudit} className={styles.secondaryButton} />
        </div>
        <div className={styles.searchRow}>
          <input
            className={styles.input}
            value={searchTerm}
            placeholder="Search all sheets"
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") runSearch();
            }}
          />
          <Button className={styles.secondaryButton} onClick={runSearch} disabled={!searchTerm.trim() || toolLoading === "search"}>
            {toolLoading === "search" ? <Spinner size="tiny" /> : "Search"}
          </Button>
        </div>
      </div>

      <div className={styles.panel}>
        <span className={styles.sectionLabel}>Intelligence log</span>
        <div className={styles.status}>{status}</div>
        <div className={styles.findings}>
          {findings.length === 0 ? (
            <Body1>No findings yet.</Body1>
          ) : (
            findings.slice(0, 30).map((item) => (
              <div className={styles.finding} key={item.id}>
                <div className={styles.findingTop}>
                  <span>{item.severity}</span>
                  <span>{item.location}</span>
                </div>
                <Body1>{item.message}</Body1>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={styles.panel}>
        <span className={styles.sectionLabel}>Conversation</span>
        <div className={styles.messages}>
          {history.length === 0 && (
            <Body1>Ask about any sheet, duplicates, inconsistencies, missing records, formulas, or the current findings.</Body1>
          )}
          {history.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`${styles.bubble} ${message.role === "user" ? styles.userBubble : ""}`}
            >
              <Body1>{message.content}</Body1>
            </div>
          ))}
          {loading && <Spinner size="small" label="Thinking..." />}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className={styles.inputRow}>
        <Field>
          <Textarea
            value={input}
            onChange={(_, data) => setInput(data.value)}
            placeholder="Ask AI across this workbook"
            resize="vertical"
            rows={3}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
        </Field>
        <Button className={styles.primaryButton} appearance="primary" onClick={send} disabled={loading || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
};

function ToolButton({
  label,
  name,
  loading,
  onClick,
  className,
}: {
  label: string;
  name: ToolName;
  loading: ToolName | null;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button className={className} onClick={onClick} disabled={loading !== null}>
      {loading === name ? <Spinner size="tiny" /> : label}
    </Button>
  );
}

function Stat({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function localAnswer(question: string, context: WorkbookContext): string {
  const normalized = question.toLowerCase();
  if (/duplicate|repeated/.test(normalized)) {
    return formatFindingsForChat(findDuplicateRows(context));
  }
  if (/inconsisten|missing|blank|formula|issue|error|problem/.test(normalized)) {
    return formatFindingsForChat(findWorkbookInconsistencies(context));
  }
  if (/clean|trim|normal/.test(normalized)) {
    return formatFindingsForChat(findCleaningOpportunities(context));
  }
  if (/summary|summarize|overview/.test(normalized)) {
    return formatFindingsForChat(summarizeWorkbook(context));
  }
  return formatFindingsForChat(searchWorkbook(context, question));
}
