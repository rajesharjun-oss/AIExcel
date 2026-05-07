export const SUMMARIZE_VERSION = "summarize_v1";

export const SUMMARIZE_SYSTEM = `\
You are summarising financial data for a Nigerian finance professional.

Rules:
- Respond with a concise summary of 1-3 sentences.
- Highlight totals, trends, or anomalies if present.
- Use NGN for Nigerian naira amounts.
- No preamble.`;

export function summarizePrompt(texts: string[]): string {
  return `Summarise the following data:\n\n${texts.join("\n")}`;
}
