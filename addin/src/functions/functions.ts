/* global CustomFunctions */

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

/**
 * Ask AI a question and return the answer as a cell value.
 * @customfunction
 * @param {string} prompt The question to ask the AI.
 * @returns {Promise<string>} The AI's answer.
 */
export async function AI_ASK(prompt: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt }),
  });
  const data: { reply: string } = await res.json();

  await logAudit("AI_ASK", [prompt], data.reply);
  return data.reply;
}

/**
 * Summarise a range of text values using AI.
 * @customfunction
 * @param {string[][]} values A range of text values to summarise.
 * @returns {Promise<string>} The AI summary.
 */
export async function AI_SUMMARIZE(values: string[][]): Promise<string> {
  const flat = values.flat().filter(Boolean).join("\n");
  const prompt = `Summarise the following data concisely:\n${flat}`;

  const res = await fetch(`${BACKEND_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt }),
  });
  const data: { reply: string } = await res.json();

  await logAudit("AI_SUMMARIZE", [values], data.reply);
  return data.reply;
}

async function logAudit(functionName: string, args: unknown[], result: unknown): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/audit/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ functionName, args, result }),
    });
  } catch {
    // audit failures are non-fatal
  }
}

CustomFunctions.associate("AI_ASK", AI_ASK);
CustomFunctions.associate("AI_SUMMARIZE", AI_SUMMARIZE);
