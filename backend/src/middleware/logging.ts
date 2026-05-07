import pino from "pino";
import type { Request, Response, NextFunction } from "express";

export const logger = pino({
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    });
  });
  next();
}
