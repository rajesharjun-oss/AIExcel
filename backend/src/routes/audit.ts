import { Router } from "express";
import { z } from "zod";

export const auditRouter = Router();

const AuditEntrySchema = z.object({
  functionName: z.string(),
  args: z.array(z.unknown()),
  result: z.unknown(),
  cellAddress: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

const auditLog: z.infer<typeof AuditEntrySchema>[] = [];

auditRouter.post("/log", (req, res) => {
  const parsed = AuditEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const entry = { ...parsed.data, timestamp: parsed.data.timestamp ?? new Date().toISOString() };
  auditLog.push(entry);
  res.json({ logged: true, id: auditLog.length - 1 });
});

auditRouter.get("/log", (_req, res) => {
  res.json(auditLog);
});

auditRouter.delete("/log", (_req, res) => {
  auditLog.length = 0;
  res.json({ cleared: true });
});
