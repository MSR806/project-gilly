import {
  AgentConfig,
  Grant,
  type Run,
  RunStep,
  type Session,
  SlackConnection,
  User,
} from "@gilly/core";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./client.ts";
import {
  agents,
  credentials,
  followUps,
  gatewayTokens,
  grants,
  runSteps,
  runs,
  sessions,
  slackConnections,
  toolCalls,
  users,
} from "./schema.ts";

const now = () => Date.now();

// --- Agents: config, mutable at runtime via the management API ---------------

type AgentRow = typeof agents.$inferSelect;

/** Parse a stored row back into a validated `AgentConfig` (JSON arrays + Zod check). */
function rowToAgent(row: AgentRow): AgentConfig {
  return AgentConfig.parse({
    id: row.id,
    name: row.name,
    model: row.model,
    systemPrompt: row.systemPrompt,
    tools: row.tools ? JSON.parse(row.tools) : undefined,
    skills: row.skills ? JSON.parse(row.skills) : undefined,
    connectors: row.connectors ? JSON.parse(row.connectors) : undefined,
  });
}

/** Validate config and shape it for storage (arrays → JSON text, empty → null). */
function agentToRow(cfg: AgentConfig): AgentRow {
  const a = AgentConfig.parse(cfg);
  return {
    id: a.id,
    name: a.name,
    model: a.model,
    systemPrompt: a.systemPrompt,
    tools: a.tools?.length ? JSON.stringify(a.tools) : null,
    skills: a.skills?.length ? JSON.stringify(a.skills) : null,
    connectors: a.connectors?.length ? JSON.stringify(a.connectors) : null,
    createdAt: now(),
  };
}

/** All agents, oldest first (so the seeded default stays first). */
export function listAgents(db: Db): AgentConfig[] {
  return db
    .select()
    .from(agents)
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .all()
    .map(rowToAgent);
}

export function getAgent(db: Db, id: string): AgentConfig | undefined {
  const row = db.select().from(agents).where(eq(agents.id, id)).get();
  return row ? rowToAgent(row) : undefined;
}

/** Insert a new agent. Throws if the id already exists. */
export function createAgent(db: Db, cfg: AgentConfig): AgentConfig {
  if (getAgent(db, cfg.id)) throw new Error(`Agent "${cfg.id}" already exists`);
  db.insert(agents).values(agentToRow(cfg)).run();
  return cfg;
}

/** Replace an existing agent's config (id is immutable). Throws if it doesn't exist. */
export function updateAgent(db: Db, id: string, cfg: AgentConfig): AgentConfig {
  if (!getAgent(db, id)) throw new Error(`Agent "${id}" not found`);
  const row = agentToRow({ ...cfg, id });
  db.update(agents)
    .set({
      name: row.name,
      model: row.model,
      systemPrompt: row.systemPrompt,
      tools: row.tools,
      skills: row.skills,
      connectors: row.connectors,
    })
    .where(eq(agents.id, id))
    .run();
  return { ...cfg, id };
}

export function deleteAgent(db: Db, id: string): void {
  db.delete(agents).where(eq(agents.id, id)).run();
}

/** Find the Session for a conversation key, creating it on first contact. */
export function getOrCreateSession(
  db: Db,
  input: { agentId: string; source: string; sourceKey: string },
): Session {
  const existing = db.select().from(sessions).where(eq(sessions.sourceKey, input.sourceKey)).get();
  if (existing) return existing;
  const row = { id: crypto.randomUUID(), ...input, harnessSessionId: null, createdAt: now() };
  db.insert(sessions).values(row).run();
  return row;
}

/** Look up a session by id (for re-reading the latest harness session id mid-batch). */
export function getSessionById(db: Db, id: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

/** Look up a session by its channel-native conversation key. */
export function getSessionBySourceKey(db: Db, sourceKey: string): Session | undefined {
  return db.select().from(sessions).where(eq(sessions.sourceKey, sourceKey)).get();
}

/** List sessions for one agent/channel, newest first. */
export function listSessions(db: Db, input: { agentId: string; source: string }): Session[] {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.agentId, input.agentId), eq(sessions.source, input.source)))
    .orderBy(desc(sessions.createdAt))
    .all();
}

/** Persist the harness session id so follow-ups resume the same loop. */
export function setHarnessSession(db: Db, sessionId: string, harnessSessionId: string): void {
  db.update(sessions).set({ harnessSessionId }).where(eq(sessions.id, sessionId)).run();
}

/** True if the session already has a run in flight (enforces one active run per session). */
export function hasActiveRun(db: Db, sessionId: string): boolean {
  return !!db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.sessionId, sessionId), eq(runs.status, "running")))
    .get();
}

/** Start a run in the `running` state. */
export function createRun(db: Db, sessionId: string, input: string): Run {
  const row: Run = {
    id: crypto.randomUUID(),
    sessionId,
    status: "running",
    input,
    output: null,
    error: null,
    createdAt: now(),
  };
  db.insert(runs).values(row).run();
  return row;
}

export function getRun(db: Db, id: string): Run | undefined {
  const row = db.select().from(runs).where(eq(runs.id, id)).get();
  return row ? { ...row, status: row.status as Run["status"] } : undefined;
}

/** List every run in a session in conversation order. */
export function listRuns(db: Db, sessionId: string): Run[] {
  return db
    .select()
    .from(runs)
    .where(eq(runs.sessionId, sessionId))
    .orderBy(asc(runs.createdAt))
    .all()
    .map((row) => ({ ...row, status: row.status as Run["status"] }));
}

export function appendRunStep(db: Db, runId: string, step: RunStep): void {
  db.insert(runSteps)
    .values({ runId, step: JSON.stringify(RunStep.parse(step)) })
    .run();
}

export function listRunSteps(db: Db, runId: string): RunStep[] {
  return db
    .select({ step: runSteps.step })
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.id))
    .all()
    .map(({ step }) => RunStep.parse(JSON.parse(step)));
}

export function completeRun(db: Db, runId: string, output: string): void {
  db.update(runs).set({ status: "completed", output }).where(eq(runs.id, runId)).run();
}

export function failRun(db: Db, runId: string, error: string): void {
  db.update(runs).set({ status: "error", error }).where(eq(runs.id, runId)).run();
}

/** Fail unfinished runs owned by a channel source after its in-process workers were lost. */
export function failRunningRunsBySource(db: Db, source: string, error: string): number {
  const sessionIds = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.source, source))
    .all()
    .map((session) => session.id);
  if (!sessionIds.length) return 0;
  const runIds = db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.status, "running"), inArray(runs.sessionId, sessionIds)))
    .all()
    .map((run) => run.id);
  if (!runIds.length) return 0;
  db.update(runs).set({ status: "error", error }).where(inArray(runs.id, runIds)).run();
  return runIds.length;
}

/** Queue a follow-up received while a run was active. `ref` is an opaque caller id. */
export function enqueueFollowUp(db: Db, sessionId: string, input: string, ref?: string): void {
  db.insert(followUps)
    .values({ id: crypto.randomUUID(), sessionId, input, ref: ref ?? null, createdAt: now() })
    .run();
}

/** Drain *all* queued follow-ups for a session (FIFO order) and remove them. */
export function dequeueAllFollowUps(
  db: Db,
  sessionId: string,
): { input: string; ref: string | null }[] {
  const rows = db
    .select()
    .from(followUps)
    .where(eq(followUps.sessionId, sessionId))
    .orderBy(asc(followUps.createdAt))
    .all();
  if (rows.length) db.delete(followUps).where(eq(followUps.sessionId, sessionId)).run();
  return rows.map((r) => ({ input: r.input, ref: r.ref }));
}

// --- Users: auto-provisioned on first Slack contact --------------------------

type UserRow = typeof users.$inferSelect;

function rowToUser(row: UserRow): User {
  return User.parse({
    id: row.id,
    slackUserId: row.slackUserId,
    name: row.name,
    meta: row.meta ? JSON.parse(row.meta) : undefined,
    isAdmin: row.isAdmin === 1,
    createdAt: row.createdAt,
  });
}

function userToRow(user: User): UserRow {
  const u = User.parse(user);
  return {
    id: u.id,
    slackUserId: u.slackUserId,
    name: u.name,
    meta: u.meta ? JSON.stringify(u.meta) : null,
    isAdmin: u.isAdmin ? 1 : 0,
    createdAt: u.createdAt,
  };
}

/** Insert (on first contact) or refresh name/meta for a Slack identity; returns the User. */
export function upsertUserBySlackId(
  db: Db,
  input: { slackUserId: string; name: string; meta?: Record<string, unknown> },
): User {
  const existing = getUserBySlackId(db, input.slackUserId);
  if (existing) {
    const updated = { ...existing, name: input.name, meta: input.meta };
    db.update(users)
      .set({ name: updated.name, meta: updated.meta ? JSON.stringify(updated.meta) : null })
      .where(eq(users.id, existing.id))
      .run();
    return User.parse(updated);
  }
  const user: User = {
    id: crypto.randomUUID(),
    slackUserId: input.slackUserId,
    name: input.name,
    meta: input.meta,
    isAdmin: false,
    createdAt: now(),
  };
  db.insert(users).values(userToRow(user)).run();
  return user;
}

export function getUser(db: Db, id: string): User | undefined {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  return row ? rowToUser(row) : undefined;
}

export function getUserBySlackId(db: Db, slackUserId: string): User | undefined {
  const row = db.select().from(users).where(eq(users.slackUserId, slackUserId)).get();
  return row ? rowToUser(row) : undefined;
}

/** All users, oldest first. */
export function listUsers(db: Db): User[] {
  return db.select().from(users).orderBy(asc(users.createdAt), asc(users.id)).all().map(rowToUser);
}

export function setAdmin(db: Db, id: string, isAdmin: boolean): void {
  db.update(users)
    .set({ isAdmin: isAdmin ? 1 : 0 })
    .where(eq(users.id, id))
    .run();
}

// --- Grants: per-user tool permissions ---------------------------------------

/** All grants for a user, oldest first. */
export function listGrants(db: Db, userId: string): Grant[] {
  return db
    .select()
    .from(grants)
    .where(eq(grants.userId, userId))
    .orderBy(asc(grants.createdAt), asc(grants.id))
    .all()
    .map((row) => Grant.parse(row));
}

export function addGrant(db: Db, userId: string, toolPattern: string): Grant {
  const grant: Grant = { id: crypto.randomUUID(), userId, toolPattern, createdAt: now() };
  db.insert(grants).values(grant).run();
  return grant;
}

export function deleteGrant(db: Db, id: string): void {
  db.delete(grants).where(eq(grants.id, id)).run();
}

// --- Credentials: connector secrets, keyed by (provider, key) ----------------

/** All key/value pairs stored for a provider. */
export function getCredential(db: Db, provider: string): { key: string; value: string }[] {
  return db
    .select({ key: credentials.key, value: credentials.value })
    .from(credentials)
    .where(eq(credentials.provider, provider))
    .all();
}

/** Upsert a single credential value on (provider, key). */
export function setCredential(db: Db, provider: string, key: string, value: string): void {
  db.insert(credentials)
    .values({ provider, key, value })
    .onConflictDoUpdate({ target: [credentials.provider, credentials.key], set: { value } })
    .run();
}

/** Delete a single credential row on (provider, key). No-op if absent. */
export function deleteCredential(db: Db, provider: string, key: string): void {
  db.delete(credentials)
    .where(and(eq(credentials.provider, provider), eq(credentials.key, key)))
    .run();
}

// --- Tool calls: invocation trace --------------------------------------------

export function insertToolCall(
  db: Db,
  input: {
    runId: string;
    userId?: string;
    tool: string;
    args: unknown;
    durationMs: number;
    status: string;
  },
): void {
  db.insert(toolCalls)
    .values({
      id: crypto.randomUUID(),
      runId: input.runId,
      userId: input.userId ?? null,
      tool: input.tool,
      args: input.args !== undefined ? JSON.stringify(input.args) : null,
      durationMs: input.durationMs,
      status: input.status,
      createdAt: now(),
    })
    .run();
}

// --- Gateway tokens: short-lived run tool-catalog tokens ---------------------

type GatewayTokenRow = typeof gatewayTokens.$inferSelect;

/** Mint an opaque token carrying catalog connectors and invocation grants. */
export function createGatewayToken(
  db: Db,
  input: {
    runId: string;
    userId: string;
    agentId: string;
    connectors: string[];
    grants: string[];
    ttlMs: number;
  },
): string {
  const token = crypto.randomUUID();
  db.insert(gatewayTokens)
    .values({
      token,
      runId: input.runId,
      userId: input.userId,
      agentId: input.agentId,
      connectors: JSON.stringify(input.connectors),
      grants: JSON.stringify(input.grants),
      expiresAt: now() + input.ttlMs,
      createdAt: now(),
    })
    .run();
  return token;
}

/** Look up a token with its JSON arrays parsed. Caller checks `expiresAt`. */
export function getGatewayToken(
  db: Db,
  token: string,
):
  | (Omit<GatewayTokenRow, "connectors" | "grants"> & {
      connectors: string[];
      grants: string[];
    })
  | undefined {
  const row = db.select().from(gatewayTokens).where(eq(gatewayTokens.token, token)).get();
  return row
    ? {
        ...row,
        connectors: JSON.parse(row.connectors),
        grants: JSON.parse(row.grants),
      }
    : undefined;
}

export function deleteGatewayTokensForRun(db: Db, runId: string): void {
  db.delete(gatewayTokens).where(eq(gatewayTokens.runId, runId)).run();
}

// --- Slack connections: web-managed, tokens vault-encrypted by the caller -----

type SlackConnectionRow = typeof slackConnections.$inferSelect;

function rowToSlackConnection(row: SlackConnectionRow): SlackConnection {
  return SlackConnection.parse({
    id: row.id,
    name: row.name,
    agentId: row.agentId,
    botToken: row.botToken,
    appToken: row.appToken,
    teamId: row.teamId ?? undefined,
    teamName: row.teamName ?? undefined,
    status: row.status,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
  });
}

/** All connections, oldest first. */
export function listSlackConnections(db: Db): SlackConnection[] {
  return db
    .select()
    .from(slackConnections)
    .orderBy(asc(slackConnections.createdAt), asc(slackConnections.id))
    .all()
    .map(rowToSlackConnection);
}

export function getSlackConnection(db: Db, id: string): SlackConnection | undefined {
  const row = db.select().from(slackConnections).where(eq(slackConnections.id, id)).get();
  return row ? rowToSlackConnection(row) : undefined;
}

/** Insert a fully-formed connection (tokens already encrypted). Throws if the id exists. */
export function createSlackConnection(db: Db, conn: SlackConnection): SlackConnection {
  if (getSlackConnection(db, conn.id))
    throw new Error(`Slack connection "${conn.id}" already exists`);
  const c = SlackConnection.parse(conn);
  db.insert(slackConnections)
    .values({
      id: c.id,
      name: c.name,
      agentId: c.agentId,
      botToken: c.botToken,
      appToken: c.appToken,
      teamId: c.teamId ?? null,
      teamName: c.teamName ?? null,
      status: c.status,
      lastError: c.lastError ?? null,
      createdAt: c.createdAt,
    })
    .run();
  return c;
}

/** Update the user-editable fields. Only keys present in `patch` are written. Throws if absent. */
export function updateSlackConnection(
  db: Db,
  id: string,
  patch: {
    name?: string;
    agentId?: string;
    botToken?: string;
    appToken?: string;
    teamId?: string;
    teamName?: string;
  },
): SlackConnection {
  const existing = getSlackConnection(db, id);
  if (!existing) throw new Error(`Slack connection "${id}" not found`);
  const set: Partial<SlackConnectionRow> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.agentId !== undefined) set.agentId = patch.agentId;
  if (patch.botToken !== undefined) set.botToken = patch.botToken;
  if (patch.appToken !== undefined) set.appToken = patch.appToken;
  if (patch.teamId !== undefined) set.teamId = patch.teamId;
  if (patch.teamName !== undefined) set.teamName = patch.teamName;
  db.update(slackConnections).set(set).where(eq(slackConnections.id, id)).run();
  return getSlackConnection(db, id) as SlackConnection;
}

/** Record a connection's start/runtime outcome (the manager calls this). */
export function setSlackConnectionStatus(
  db: Db,
  id: string,
  status: SlackConnection["status"],
  lastError?: string,
): void {
  db.update(slackConnections)
    .set({ status, lastError: lastError ?? null })
    .where(eq(slackConnections.id, id))
    .run();
}

export function deleteSlackConnection(db: Db, id: string): void {
  db.delete(slackConnections).where(eq(slackConnections.id, id)).run();
}
