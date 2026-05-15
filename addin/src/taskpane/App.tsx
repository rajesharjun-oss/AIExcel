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
    gap: tokens.spacingVerticalS,
    height: "100vh",
    boxSizing: "border-box",
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  muted: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalS,
  },
  stat: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: tokens.spacingHorizontalS,
    minHeight: "54px",
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    textTransform: "uppercase",
  },
  statValue: {
    display: "block",
    marginTop: "2px",
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tools: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalS,
  },
  searchRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: tokens.spacingHorizontalS,
  },
  input: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "0 10px",
    minHeight: "32px",
    minWidth: 0,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  panel: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    overflowY: "auto",
    padding: tokens.spacingHorizontalS,
  },
  findings: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  finding: {
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalS,
  },
  findingTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    marginBottom: "3px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    textTransform: "uppercase",
  },
  messages: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  bubble: {
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    whiteSpace: "pre-wrap",
  },
  userBubble: {
    backgroundColor: tokens.colorBrandBackground2,
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
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
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
        <Title2>AIExcel Assistant</Title2>
        <span className={styles.muted}>Active sheet: {activeSheet}</span>
      </div>

      <div className={styles.stats}>
        <Stat label="Sheets" value={String(profile?.sheetCount ?? 0)} styles={styles} />
        <Stat label="Rows" value={String(profile?.totalRows ?? 0)} styles={styles} />
        <Stat label="Findings" value={findingSummary} styles={styles} />
      </div>

      <div>
        <div className={styles.tools}>
          <ToolButton label="Index Workbook" name="index" loading={toolLoading} onClick={indexWorkbook} />
          <ToolButton label="Find Duplicates" name="duplicates" loading={toolLoading} onClick={runDuplicates} />
          <ToolButton label="Find Issues" name="inconsistencies" loading={toolLoading} onClick={runInconsistencies} />
          <ToolButton label="Clean Selection" name="clean" loading={toolLoading} onClick={runCleaning} />
          <ToolButton label="AI Audit Sheet" name="audit" loading={toolLoading} onClick={runAudit} />
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
          <Button onClick={runSearch} disabled={!searchTerm.trim() || toolLoading === "search"}>
            {toolLoading === "search" ? <Spinner size="tiny" /> : "Search"}
          </Button>
        </div>
      </div>

      <div className={styles.panel}>
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
        <Button appearance="primary" onClick={send} disabled={loading || !input.trim()}>
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
}: {
  label: string;
  name: ToolName;
  loading: ToolName | null;
  onClick: () => void;
}) {
  return (
    <Button onClick={onClick} disabled={loading !== null}>
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
