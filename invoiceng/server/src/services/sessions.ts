import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export interface SessionUser {
  readonly userId: string;
  readonly businessId: string;
  readonly name: string;
  readonly phone: string;
}

export interface CreatedSession {
  /** Raw token for the cookie; only its hash is persisted. */
  readonly token: string;
  readonly expiresAt: number;
}

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createSession(db: Db, userId: string, ttlHours: number, now: number): CreatedSession {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = now + ttlHours * 3_600_000;
  db.insert(sessions)
    .values({ tokenHash: hashToken(token), userId, expiresAt, createdAt: now })
    .run();
  return { token, expiresAt };
}

export function resolveSession(db: Db, token: string, now: number): SessionUser | null {
  if (token.length === 0 || token.length > 128) return null;
  const row = db
    .select({
      userId: users.id,
      businessId: users.businessId,
      name: users.name,
      phone: users.phone,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now), isNull(sessions.revokedAt)),
    )
    .get();
  return row ?? null;
}

export function revokeSession(db: Db, token: string, now: number): void {
  db.update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .run();
}
