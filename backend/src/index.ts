import "dotenv/config";
import express from "express";
import cors from "cors";
import { aiRouter } from "./routes/ai";
import { auditRouter } from "./routes/audit";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.ADDIN_ORIGIN ?? "https://localhost:3000" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/ai", aiRouter);
app.use("/api/audit", auditRouter);

app.listen(PORT, () => {
  console.log(`AIExcel backend listening on port ${PORT}`);
});
