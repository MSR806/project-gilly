import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

/** Idempotent DDL — MVP keeps migrations inline instead of a migration tool. */
function migrate(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, source TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE, harness_session_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL,
      input TEXT NOT NULL, output TEXT, error TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, input TEXT NOT NULL, ref TEXT, created_at INTEGER NOT NULL
    );
  `);
  // Add `ref` to follow_ups created before it existed (ignore if already present).
  try {
    sqlite.exec("ALTER TABLE follow_ups ADD COLUMN ref TEXT;");
  } catch {
    // column already exists
  }
}

/** Open the SQLite store, apply DDL, and return a Drizzle client. */
export function createDb(path: string) {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}
