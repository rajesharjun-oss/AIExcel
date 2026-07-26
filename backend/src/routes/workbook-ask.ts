import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute";
import { z } from "zod";
import { callLLM, SONNET } from "../llm/client";
import { WORKBOOK_ASK_SYSTEM, WORKBOOK_ASK_VERSION, workbookAskPrompt } from "../llm/prompts/workbook_ask_v1";
import { cacheGet, cacheKey, cacheSet } from "../cache/sqlite";
import type { WorkbookAskRequest, WorkbookAskResponse } from "@aiexcel/shared";

export const workbookAskRouter = Router();

const Schema = z.object({
  question: z.string().min(1).max(4000),
  workbookProfile: z.record(z.unknown()).optional(),
  visibleFindings: z.array(z.unknown()).max(60).optional(),
  financialReport: z.record(z.unknown()).nullish(),
});

workbookAskRouter.post("/", asyncRoute(async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { question, workbookProfile, visibleFindings, financialReport } = parsed.data as WorkbookAskRequest;
  const context: Record<string, unknown> = {};
  if (workbookProfile) context.workbookProfile = workbookProfile;
  if (visibleFindings?.length) context.visibleFindings = visibleFindings;
  if (financialReport) context.financialReport = financialReport;

  const key = cacheKey({ fn: WORKBOOK_ASK_VERSION, question, context });
  const hit = cacheGet(key);
  if (hit) {
    const response: WorkbookAskResponse = { answer: hit, cached: true };
    res.json(response);
    return;
  }

  const answer = await callLLM({
    model: SONNET,
    system: WORKBOOK_ASK_SYSTEM,
    userMessage: workbookAskPrompt(question, context),
    maxTokens: 1024,
    functionName: WORKBOOK_ASK_VERSION,
  });

  cacheSet(key, answer, 3_600);
  const response: WorkbookAskResponse = { answer, cached: false };
  res.json(response);
}));
