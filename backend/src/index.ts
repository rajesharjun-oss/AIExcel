import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { requestLogger, logger } from "./middleware/logging";
import { rateLimit } from "./middleware/rateLimit";
import { auth } from "./middleware/auth";
import { classifyRouter } from "./routes/classify";
import { extractRouter } from "./routes/extract";
import { cleanRouter } from "./routes/clean";
import { matchRouter } from "./routes/match";
import { summarizeRouter } from "./routes/summarize";
import { askRouter } from "./routes/ask";
import { chatRouter } from "./routes/chat";
import { auditRouter } from "./routes/audit";

if (!process.env.ANTHROPIC_API_KEY) {
  logger.error("ANTHROPIC_API_KEY is not set — exiting");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.ADDIN_ORIGIN ?? "https://localhost:3000" }));
app.use(express.json({ limit: "5mb" }));
app.use(requestLogger);
app.use(rateLimit);
app.use(auth);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/v1/classify", classifyRouter);
app.use("/v1/extract", extractRouter);
app.use("/v1/clean", cleanRouter);
app.use("/v1/match", matchRouter);
app.use("/v1/summarize", summarizeRouter);
app.use("/v1/ask", askRouter);
app.use("/v1/chat", chatRouter);
app.use("/v1/audit", auditRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  logger.info(`AIExcel backend listening on port ${PORT}`);
});
