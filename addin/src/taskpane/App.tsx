import React, { useState } from "react";
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

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

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
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground3,
    whiteSpace: "pre-wrap",
  },
  userBubble: {
    background: tokens.colorBrandBackground2,
  },
  inputRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
});

type Message = { role: "user" | "assistant"; text: string };

export const App: React.FC = () => {
  const styles = useStyles();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const getContext = async (): Promise<Record<string, unknown> | undefined> => {
    try {
      return await Excel.run(async (ctx) => {
        const range = ctx.workbook.getSelectedRange();
        range.load(["address", "values"]);
        await ctx.sync();
        return { address: range.address, values: range.values };
      });
    } catch {
      return undefined;
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const context = await getContext();
      const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, context }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", text: data.reply ?? "No response." }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${String(err)}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.root}>
      <Title2>AIExcel Assistant</Title2>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <Body1>Ask me anything about your spreadsheet. I can see your selected range.</Body1>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`${styles.bubble} ${m.role === "user" ? styles.userBubble : ""}`}>
            <Body1>{m.text}</Body1>
          </div>
        ))}
        {loading && <Spinner size="small" label="Thinking…" />}
      </div>

      <div className={styles.inputRow}>
        <Field>
          <Textarea
            value={input}
            onChange={(_, d) => setInput(d.value)}
            placeholder="Ask about your spreadsheet…"
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
