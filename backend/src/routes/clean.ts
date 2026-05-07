import { Router } from "express";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import { CLEAN_SYSTEM, CLEAN_VERSION, cleanPrompt } from "../llm/prompts/clean_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import type { CleanRequest, CleanResponse } from "@aiexcel/shared";

export const cleanRouter = Router();

const Schema = z.object({
  text: z.string().min(1).max(2000),
});

cleanRouter.post("/", async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { text } = parsed.data as CleanRequest;
  const key = cacheKey({ fn: CLEAN_VERSION, text });
  const hit = cacheGet(key);

  if (hit) {
    const response: CleanResponse = { result: hit, cached: true };
    res.json(response);
    return;
  }

  const result = await callLLM({
    model: HAIKU,
    system: CLEAN_SYSTEM,
    userMessage: cleanPrompt(text),
    maxTokens: 256,
    functionName: CLEAN_VERSION,
  });

  cacheSet(key, result, 86_400);
  const response: CleanResponse = { result, cached: false };
  res.json(response);
});
