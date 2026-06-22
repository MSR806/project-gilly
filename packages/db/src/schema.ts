import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ─── Registry tables (agents, skills, agent_skills) ────────────────────────

/** UI/DB-managed agent configurations. */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  /** JSON-serialized string[] of tool names. */
  toolsJson: text("tools_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** UI/DB-managed skill bundles. */
export const skills = sqliteTable("skills", {
  name: text("name").primaryKey(),
  /** JSON-serialized SkillBundle.files array. */
  filesJson: text("files_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Many-to-many: which skills are attached to which agent. */
export const agentSkills = sqliteTable("agent_skills", {
  agentId: text("agent_id").notNull(),
  skillName: text("skill_name").notNull(),
  createdAt: integer("created_at").notNull(),
});

// ─── Operational state tables ──────────────────────────────────────────────

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
