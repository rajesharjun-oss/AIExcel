import type { Request, Response, NextFunction } from "express";

// Stub: in v1 there is no auth — the backend runs locally and is not exposed.
// Wire up a bearer token check here when deploying to a hosted environment.
export function auth(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
