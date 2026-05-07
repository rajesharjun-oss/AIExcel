import React, { useState, useRef, useEffect } from "react";
import {
  Button,
  Field,
  Textarea,
  Title2,
  Body1,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { post } from "../shared/api-client";
import { getWorkbookContext } from "../shared/workbook";
import type { ChatMessage, ChatRequest, ChatResponse } from "@aiexcel/shared";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    height: "100vh",
    boxSizing: "border-box",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  bubble: {
    padding: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground3,
    whiteSpace: "pre-wrap",
  },
  userBubble: {
    background: tokens.colorBrandBackground2,
    alignSelf: "flex-end",
    maxWidth: "85%",
  },
  inputRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
});

export const App: React.FC = () => {
  const styles = useStyles();
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const newHistory: ChatMessage[] = [...history, { role: "user", content: text }];
    setHistory(newHistory);
    setInput("");
    setLoading(true);

    try {
      const workbookContext = await getWorkbookContext().catch(() => undefined);
      const body: ChatRequest = { messages: newHistory, workbookContext };
      const { reply } = await post<ChatResponse>("/v1/chat", body);
      setHistory((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${String(err)}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.root}>
      <Title2>AI Assistant</Title2>

      <div className={styles.messages}>
        {history.length === 0 && (
          <Body1>
            Ask me anything about your spreadsheet. I can see your selected range and active sheet.
          </Body1>
        )}
        {history.map((m, i) => (
          <div
            key={i}
            className={`${styles.bubble} ${m.role === "user" ? styles.userBubble : ""}`}
          >
            <Body1>{m.content}</Body1>
          </div>
        ))}
        {loading && <Spinner size="small" label="Thinking…" />}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputRow}>
        <Field>
          <Textarea
            value={input}
            onChange={(_, d) => setInput(d.value)}
            placeholder="Ask about your spreadsheet… (Enter to send, Shift+Enter for newline)"
            resize="vertical"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
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
