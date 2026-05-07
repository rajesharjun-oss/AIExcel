import { Router } from "express";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import { MATCH_SYSTEM, MATCH_VERSION, matchPrompt } from "../llm/prompts/match_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import type { MatchRequest, MatchResponse } from "@aiexcel/shared";

export const matchRouter = Router();

const Schema = z.object({
  value: z.string().min(1).max(500),
  list: z.string().min(1),
});

matchRouter.post("/", async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { value, list } = parsed.data as MatchRequest;
  const key = cacheKey({ fn: MATCH_VERSION, value, list });
  const hit = cacheGet(key);

  if (hit) {
    const response: MatchResponse = { result: hit, cached: true };
    res.json(response);
    return;
  }

  const result = await callLLM({
    model: HAIKU,
    system: MATCH_SYSTEM,
    userMessage: matchPrompt(value, list),
    maxTokens: 64,
    functionName: MATCH_VERSION,
  });

  cacheSet(key, result, 86_400);
  const response: MatchResponse = { result, cached: false };
  res.json(response);
});
