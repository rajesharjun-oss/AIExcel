import { Router } from "express";
import { z } from "zod";
import { anthropic, DEFAULT_MODEL } from "../lib/anthropic";

export const aiRouter = Router();

const ChatSchema = z.object({
  message: z.string().min(1),
  context: z.record(z.unknown()).optional(),
});

aiRouter.post("/chat", async (req, res) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { message, context } = parsed.data;
  const systemPrompt = context
    ? `You are an Excel AI assistant. The user's spreadsheet context:\n${JSON.stringify(context, null, 2)}`
    : "You are an Excel AI assistant. Help the user with their spreadsheet tasks.";

  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: message }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  res.json({ reply: text, usage: response.usage });
});
