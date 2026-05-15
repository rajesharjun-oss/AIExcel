import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute";
import { z } from "zod";
import { callChat, SONNET } from "../llm/client";
import { chatSystem } from "../llm/prompts/chat_v1";
import type { ChatRequest, ChatResponse } from "@aiexcel/shared";

export const chatRouter = Router();

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const Schema = z.object({
  messages: z.array(MessageSchema).min(1).max(50),
  workbookContext: z.record(z.unknown()).optional(),
});

chatRouter.post("/", asyncRoute(async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { messages, workbookContext } = parsed.data as ChatRequest;
  const ctxString = workbookContext ? JSON.stringify(workbookContext, null, 2) : undefined;

  const reply = await callChat({
    model: SONNET,
    system: chatSystem(ctxString),
    messages,
    maxTokens: 1024,
  });

  const response: ChatResponse = { reply };
  res.json(response);
}));
