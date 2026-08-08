import { Database } from "bun:sqlite";
import {
  BUILT_IN_HARNESSES,
  HarnessModel,
  isDeferredOpenModel,
  normalizeLegacyHarness,
} from "@gilly/core";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

/** Idempotent DDL — MVP keeps migrations inline instead of a migration tool. */
function migrate(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT NOT NULL, harness_id TEXT NOT NULL,
      service_tier TEXT, system_prompt TEXT NOT NULL, tools TEXT, skills TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harnesses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT,
      enabled INTEGER NOT NULL, models TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, source TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE, harness_session_id TEXT, harness_id TEXT,
      created_at INTEGER NOT NULL
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
      connectors TEXT NOT NULL, grants TEXT NOT NULL, expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slack_connections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, agent_id TEXT NOT NULL,
      bot_token TEXT NOT NULL, app_token TEXT NOT NULL, team_id TEXT, team_name TEXT,
      status TEXT NOT NULL, last_error TEXT, created_at INTEGER NOT NULL
    );
  `);
  addColumn(sqlite, "follow_ups", "ref", "TEXT");
  addColumn(sqlite, "agents", "gateway_tools", "TEXT");
  addColumn(sqlite, "agents", "connectors", "TEXT");
  addColumn(sqlite, "gateway_tokens", "tools", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(sqlite, "gateway_tokens", "connectors", "TEXT NOT NULL DEFAULT '[]'");
  const addedHarnessImage = addColumn(sqlite, "harnesses", "image", "TEXT");

  const insertHarness = sqlite.prepare(
    "INSERT OR IGNORE INTO harnesses (id, name, image, enabled, models) VALUES (?, ?, ?, ?, ?)",
  );
  for (const harness of BUILT_IN_HARNESSES) {
    insertHarness.run(
      harness.id,
      harness.name,
      harness.image,
      harness.enabled ? 1 : 0,
      JSON.stringify(harness.models),
    );
    if (addedHarnessImage) {
      sqlite.prepare("UPDATE harnesses SET image = ? WHERE id = ?").run(harness.image, harness.id);
    }
  }

  const addedAgentHarness = addColumn(
    sqlite,
    "agents",
    "harness_id",
    "TEXT NOT NULL DEFAULT 'claude'",
  );
  addColumn(sqlite, "agents", "service_tier", "TEXT");
  if (addedAgentHarness) migrateLegacyAgents(sqlite);

  const addedSessionHarness = addColumn(sqlite, "sessions", "harness_id", "TEXT");
  if (addedSessionHarness) migrateLegacySessions(sqlite);
}

function addColumn(sqlite: Database, table: string, column: string, definition: string): boolean {
  const columns = sqlite.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((candidate) => candidate.name === column)) return false;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  return true;
}

function migrateLegacyAgents(sqlite: Database): void {
  const rows = sqlite.query("SELECT id, model FROM agents").all() as {
    id: string;
    model: string;
  }[];
  const update = sqlite.prepare(
    "UPDATE agents SET harness_id = ?, model = ?, service_tier = ? WHERE id = ?",
  );
  for (const row of rows) {
    const harness = normalizeLegacyHarness(row.model);
    update.run(harness.id, harness.config.model, harness.config.serviceTier ?? null, row.id);
    if (!isDeferredOpenModel(harness.config.model)) {
      preserveLegacyModel(sqlite, harness.id, harness.config.model);
    }
  }
}

function preserveLegacyModel(sqlite: Database, harnessId: string, modelId: string): void {
  const row = sqlite.query("SELECT models FROM harnesses WHERE id = ?").get(harnessId) as {
    models: string;
  } | null;
  if (!row) return;
  const models = HarnessModel.array().parse(JSON.parse(row.models));
  if (models.some((model) => model.id === modelId)) return;
  sqlite
    .prepare("UPDATE harnesses SET models = ? WHERE id = ?")
    .run(JSON.stringify([...models, { id: modelId, name: modelId }]), harnessId);
}

function migrateLegacySessions(sqlite: Database): void {
  const rows = sqlite
    .query("SELECT id, harness_session_id FROM sessions WHERE harness_session_id IS NOT NULL")
    .all() as { id: string; harness_session_id: string }[];
  const update = sqlite.prepare(
    "UPDATE sessions SET harness_id = ?, harness_session_id = ? WHERE id = ?",
  );
  for (const row of rows) {
    const openai = row.harness_session_id.startsWith("openai:");
    const anthropic = row.harness_session_id.startsWith("anthropic:");
    const harnessId = openai ? "codex" : "claude";
    const sessionId =
      openai || anthropic
        ? row.harness_session_id.slice(row.harness_session_id.indexOf(":") + 1)
        : row.harness_session_id;
    update.run(harnessId, sessionId, row.id);
  }
}

/** Open the SQLite store, apply DDL, and return a Drizzle client. */
export function createDb(path: string) {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");
  try {
    migrate(sqlite);
    sqlite.exec("COMMIT;");
  } catch (error) {
    sqlite.exec("ROLLBACK;");
    throw error;
  }
  return drizzle(sqlite, { schema });
}
