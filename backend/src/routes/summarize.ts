import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import { SUMMARIZE_SYSTEM, SUMMARIZE_VERSION, summarizePrompt } from "../llm/prompts/summarize_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import type { SummarizeRequest, SummarizeResponse } from "@aiexcel/shared";

export const summarizeRouter = Router();

const Schema = z.object({
  texts: z.array(z.string()).min(1).max(500),
});

summarizeRouter.post("/", asyncRoute(async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { texts } = parsed.data as SummarizeRequest;
  const key = cacheKey({ fn: SUMMARIZE_VERSION, texts });
  const hit = cacheGet(key);

  if (hit) {
    const response: SummarizeResponse = { result: hit, cached: true };
    res.json(response);
    return;
  }

  const result = await callLLM({
    model: HAIKU,
    system: SUMMARIZE_SYSTEM,
    userMessage: summarizePrompt(texts),
    maxTokens: 256,
    functionName: SUMMARIZE_VERSION,
  });

  cacheSet(key, result, 3_600);
  const response: SummarizeResponse = { result, cached: false };
  res.json(response);
}));
