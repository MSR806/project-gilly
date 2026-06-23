import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * A configured agent, mutable at runtime via the management API. `tools`/`skills` are JSON
 * `string[]` (null = none); the rest mirror the `AgentConfig` schema in `@gilly/core`.
 */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  tools: text("tools"),
  skills: text("skills"),
  createdAt: integer("created_at").notNull(),
});

/** Durable conversation/work context. One Slack thread maps to one row. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  source: text("source").notNull(),
  /** Surface-native conversation key, e.g. "<channel>:<thread_ts>". */
  sourceKey: text("source_key").notNull().unique(),
  harnessSessionId: text("harness_session_id"),
  createdAt: integer("created_at").notNull(),
});

/** One execution attempt within a session. */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  status: text("status").notNull(),
  input: text("input").notNull(),
  output: text("output"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

/** Follow-up queue: inputs received while a run was active, drained as one batch. */
export const followUps = sqliteTable("follow_ups", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  input: text("input").notNull(),
  /** Opaque caller ref (e.g. Slack message ts) echoed back when the batch is answered. */
  ref: text("ref"),
  createdAt: integer("created_at").notNull(),
});
