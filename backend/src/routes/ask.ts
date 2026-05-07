import { Router } from "express";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import { ASK_SYSTEM, ASK_VERSION, askPrompt } from "../llm/prompts/ask_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import type { AskRequest, AskResponse } from "@aiexcel/shared";

export const askRouter = Router();

const Schema = z.object({
  prompt: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
});

askRouter.post("/", async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { prompt, context } = parsed.data as AskRequest;
  const key = cacheKey({ fn: ASK_VERSION, prompt, context });
  const hit = cacheGet(key);

  if (hit) {
    const response: AskResponse = { result: hit, cached: true };
    res.json(response);
    return;
  }

  const userMessage = context
    ? `Context:\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${askPrompt(prompt)}`
    : askPrompt(prompt);

  const result = await callLLM({
    model: HAIKU,
    system: ASK_SYSTEM,
    userMessage,
    maxTokens: 512,
    functionName: ASK_VERSION,
  });

  cacheSet(key, result, 3_600);
  const response: AskResponse = { result, cached: false };
  res.json(response);
});
