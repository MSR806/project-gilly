import { AgentConfig, type Run, type Session } from "@gilly/core";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { agents, followUps, runs, sessions } from "./schema.ts";

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

export function completeRun(db: Db, runId: string, output: string): void {
  db.update(runs).set({ status: "completed", output }).where(eq(runs.id, runId)).run();
}

export function failRun(db: Db, runId: string, error: string): void {
  db.update(runs).set({ status: "error", error }).where(eq(runs.id, runId)).run();
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
