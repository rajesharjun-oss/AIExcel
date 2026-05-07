import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../middleware/logging";

export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-4-6";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface LLMCallOptions {
  model: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
  functionName: string;
}

export async function callLLM(opts: LLMCallOptions): Promise<string> {
  const { model, system, userMessage, maxTokens = 256, functionName } = opts;
  const start = Date.now();

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      logger.info({
        function: functionName,
        model,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        duration_ms: Date.now() - start,
        attempt,
        cached: false,
      });

      return response.content.find((b) => b.type === "text")?.text ?? "";
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (retryable && attempt < 4) {
        await sleep(Math.pow(2, attempt - 1) * 1_000);
        continue;
      }
      throw err;
    }
  }

  throw new Error("callLLM: exhausted retries");
}

export interface LLMChatOptions {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}

export async function callChat(opts: LLMChatOptions): Promise<string> {
  const { model, system, messages, maxTokens = 1024 } = opts;
  const start = Date.now();

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      });

      logger.info({
        function: "chat",
        model,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        duration_ms: Date.now() - start,
        attempt,
      });

      return response.content.find((b) => b.type === "text")?.text ?? "";
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (retryable && attempt < 4) {
        await sleep(Math.pow(2, attempt - 1) * 1_000);
        continue;
      }
      throw err;
    }
  }

  throw new Error("callChat: exhausted retries");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
