import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  connectors: text("connectors"),
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

/** A person who triggers runs, auto-provisioned on first Slack contact. `meta` is JSON (null = none). */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  slackUserId: text("slack_user_id").notNull().unique(),
  name: text("name").notNull(),
  meta: text("meta"),
  isAdmin: integer("is_admin").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A per-user permission to use tools matching `tool_pattern`. */
export const grants = sqliteTable("grants", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  toolPattern: text("tool_pattern").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Connector secrets, keyed by provider + key. Composite PK on (provider, key). */
export const credentials = sqliteTable(
  "credentials",
  {
    provider: text("provider").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.key] })],
);

/** One tool invocation, for tracing/audit. `args` is JSON (null = none). */
export const toolCalls = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  userId: text("user_id"),
  tool: text("tool").notNull(),
  args: text("args"),
  durationMs: integer("duration_ms").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
});

/**
 * A Slack workspace connection: bot/app tokens (vault-encrypted) + the agent it routes to.
 * Mirrors the `SlackConnection` schema in `@gilly/core`. Many can coexist; managed via the web API.
 */
export const slackConnections = sqliteTable("slack_connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agentId: text("agent_id").notNull(),
  botToken: text("bot_token").notNull(),
  appToken: text("app_token").notNull(),
  teamId: text("team_id"),
  teamName: text("team_name"),
  status: text("status").notNull(),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
});

/** Short-lived opaque token minting a run's effective tool catalog. `grants` is JSON `string[]`. */
export const gatewayTokens = sqliteTable("gateway_tokens", {
  token: text("token").primaryKey(),
  runId: text("run_id").notNull(),
  userId: text("user_id").notNull(),
  agentId: text("agent_id").notNull(),
  grants: text("grants").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});
