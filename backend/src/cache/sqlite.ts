import Database from "better-sqlite3";
import { createHash } from "crypto";
import path from "path";

const db = new Database(path.join(process.cwd(), "cache.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key  TEXT    PRIMARY KEY,
    value TEXT   NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

setInterval(() => {
  db.prepare("DELETE FROM cache WHERE expires_at < ?").run(Date.now());
}, 60_000).unref();

export function cacheKey(inputs: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

export function cacheGet(key: string): string | null {
  const row = db
    .prepare("SELECT value FROM cache WHERE key = ? AND expires_at > ?")
    .get(key, Date.now()) as { value: string } | undefined;
  return row?.value ?? null;
}

export function cacheSet(key: string, value: string, ttlSeconds: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)"
  ).run(key, value, Date.now() + ttlSeconds * 1_000);
}
