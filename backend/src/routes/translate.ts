import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import { TRANSLATE_SYSTEM, TRANSLATE_VERSION, translatePrompt } from "../llm/prompts/translate_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import type { TranslateRequest, TranslateResponse } from "@aiexcel/shared";

export const translateRouter = Router();

const Schema = z.object({
  texts: z.array(z.string().min(1).max(500)).min(1).max(200),
  targetLanguage: z.string().min(2).max(32),
});

const parseTranslations = (raw: string, expectedLength: number): string[] | null => {
  try {
    const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length !== expectedLength) return null;
    if (!parsed.every((item) => typeof item === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
};

translateRouter.post("/", asyncRoute(async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { texts, targetLanguage } = parsed.data as TranslateRequest;
  const key = cacheKey({ fn: TRANSLATE_VERSION, texts, targetLanguage });
  const hit = cacheGet(key);

  if (hit) {
    const cachedTranslations = parseTranslations(hit, texts.length);
    if (cachedTranslations) {
      const response: TranslateResponse = { translations: cachedTranslations, cached: true };
      res.json(response);
      return;
    }
  }

  const result = await callLLM({
    model: HAIKU,
    system: TRANSLATE_SYSTEM,
    userMessage: translatePrompt(texts, targetLanguage),
    maxTokens: 2048,
    functionName: TRANSLATE_VERSION,
  });

  const translations = parseTranslations(result, texts.length);
  if (!translations) {
    res.status(502).json({ error: "Translation service returned an unexpected format" });
    return;
  }

  cacheSet(key, JSON.stringify(translations), 86_400);
  const response: TranslateResponse = { translations, cached: false };
  res.json(response);
}));
