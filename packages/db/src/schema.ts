import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

/** FIFO follow-up queue: inputs received while a run was active. */
export const followUps = sqliteTable("follow_ups", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  input: text("input").notNull(),
  createdAt: integer("created_at").notNull(),
});
