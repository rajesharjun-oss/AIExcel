import { Router } from "express";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import { CLASSIFY_SYSTEM, CLASSIFY_VERSION, classifyPrompt } from "../llm/prompts/classify_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import { asyncRoute } from "../middleware/asyncRoute";
import type { ClassifyRequest, ClassifyResponse } from "@aiexcel/shared";

export const classifyRouter = Router();

const Schema = z.object({
  text: z.string().min(1).max(2000),
  categories: z.string().min(1),
});

classifyRouter.post("/", asyncRoute(async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { text, categories } = parsed.data as ClassifyRequest;
  const key = cacheKey({ fn: CLASSIFY_VERSION, text, categories });
  const hit = cacheGet(key);

  if (hit) {
    const response: ClassifyResponse = { result: hit, cached: true };
    res.json(response);
    return;
  }

  const result = await callLLM({
    model: HAIKU,
    system: CLASSIFY_SYSTEM,
    userMessage: classifyPrompt(text, categories),
    maxTokens: 32,
    functionName: CLASSIFY_VERSION,
  });

  cacheSet(key, result, 86_400);
  const response: ClassifyResponse = { result, cached: false };
  res.json(response);
}));
