import { Router } from "express";
import { z } from "zod";
import { callLLM, HAIKU } from "../llm/client";
import type { AuditCheckRequest, AuditCheckResponse, AuditResult } from "@aiexcel/shared";

export const auditRouter = Router();

const Schema = z.object({
  sheetName: z.string(),
  values: z.array(z.array(z.unknown())),
  headers: z.array(z.string()).optional(),
});

auditRouter.post("/check", async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { sheetName, values, headers } = parsed.data as AuditCheckRequest;
  const sample = values.slice(0, 20).map((r) => r.join("\t")).join("\n");

  const raw = await callLLM({
    model: HAIKU,
    system: `\
You are auditing spreadsheet data for a Nigerian finance professional.
Identify anomalies: outliers, suspicious values, cross-column inconsistencies, implausible numbers.
Respond with a JSON array of objects: [{severity, message, location}].
severity is "error", "warning", or "suggestion".
location is a cell reference like "A3" or a range like "B2:B50".
Return an empty array [] if nothing is suspicious.
Respond with ONLY the JSON array.`,
    userMessage: `Sheet: ${sheetName}\nHeaders: ${(headers ?? []).join(", ")}\n\nData (first 20 rows):\n${sample}`,
    maxTokens: 512,
    functionName: "audit_check_v1",
  });

  let results: AuditResult[] = [];
  try {
    const parsed = JSON.parse(raw) as Omit<AuditResult, "id">[];
    results = parsed.map((r, i) => ({ ...r, id: `ai-${Date.now()}-${i}` }));
  } catch {
    // model didn't return valid JSON — return empty results
  }

  const response: AuditCheckResponse = { results };
  res.json(response);
});
