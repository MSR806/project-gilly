import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

/** Idempotent DDL — MVP keeps migrations inline instead of a migration tool. */
function migrate(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT NOT NULL,
      system_prompt TEXT NOT NULL, tools TEXT, skills TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, source TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE, harness_session_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL,
      input TEXT NOT NULL, output TEXT, error TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, step TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, input TEXT NOT NULL, ref TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, slack_user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      meta TEXT, is_admin INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tool_pattern TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credentials (
      provider TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY (provider, key)
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id TEXT, tool TEXT NOT NULL,
      args TEXT, duration_ms INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gateway_tokens (
      token TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      grants TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slack_connections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, agent_id TEXT NOT NULL,
      bot_token TEXT NOT NULL, app_token TEXT NOT NULL, team_id TEXT, team_name TEXT,
      status TEXT NOT NULL, last_error TEXT, created_at INTEGER NOT NULL
    );
  `);
  // Add `ref` to follow_ups created before it existed (ignore if already present).
  try {
    sqlite.exec("ALTER TABLE follow_ups ADD COLUMN ref TEXT;");
  } catch {
    // column already exists
  }
  // Add `connectors` to agents created before it existed (ignore if already present).
  try {
    sqlite.exec("ALTER TABLE agents ADD COLUMN connectors TEXT;");
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
