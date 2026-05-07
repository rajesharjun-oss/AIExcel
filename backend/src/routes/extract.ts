import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import { EXTRACT_SYSTEM, EXTRACT_VERSION, extractPrompt } from "../llm/prompts/extract_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import type { ExtractRequest, ExtractResponse } from "@aiexcel/shared";

export const extractRouter = Router();

const Schema = z.object({
  text: z.string().min(1).max(2000),
  field: z.string().min(1),
});

extractRouter.post("/", asyncRoute(async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { text, field } = parsed.data as ExtractRequest;
  const key = cacheKey({ fn: EXTRACT_VERSION, text, field });
  const hit = cacheGet(key);

  if (hit) {
    const response: ExtractResponse = { result: hit, cached: true };
    res.json(response);
    return;
  }

  const result = await callLLM({
    model: HAIKU,
    system: EXTRACT_SYSTEM,
    userMessage: extractPrompt(text, field),
    maxTokens: 64,
    functionName: EXTRACT_VERSION,
  });

  cacheSet(key, result, 86_400);
  const response: ExtractResponse = { result, cached: false };
  res.json(response);
}));
