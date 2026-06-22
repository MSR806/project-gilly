import type { Run, Session } from "@gilly/core";
import { AgentConfig } from "@gilly/core";
import { SkillBundle } from "@gilly/harness-protocol";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { agentSkills, agents, followUps, runs, sessions, skills } from "./schema.ts";

const now = () => Date.now();

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

/** Pop the oldest queued follow-up for a session, or null if the queue is empty. */
export function dequeueFollowUp(db: Db, sessionId: string): { id: string; input: string } | null {
  const next = db
    .select()
    .from(followUps)
    .where(eq(followUps.sessionId, sessionId))
    .orderBy(asc(followUps.createdAt))
    .get();
  if (!next) return null;
  db.delete(followUps).where(eq(followUps.id, next.id)).run();
  return { id: next.id, input: next.input };
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

// ─── Registry: Agents ──────────────────────────────────────────────────────

/** List all agent rows from the registry table. */
export function listAgentRows(db: Db) {
  return db.select().from(agents).all();
}

/** Upsert an agent config into the registry. */
export function upsertAgentConfig(db: Db, config: AgentConfig): void {
  const ts = now();
  const toolsJson = config.tools ? JSON.stringify(config.tools) : null;
  const existing = db.select().from(agents).where(eq(agents.id, config.id)).get();
  if (existing) {
    db.update(agents)
      .set({
        name: config.name,
        model: config.model,
        systemPrompt: config.systemPrompt,
        toolsJson,
        updatedAt: ts,
      })
      .where(eq(agents.id, config.id))
      .run();
  } else {
    db.insert(agents)
      .values({
        id: config.id,
        name: config.name,
        model: config.model,
        systemPrompt: config.systemPrompt,
        toolsJson,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
  }
}

// ─── Registry: Skills ──────────────────────────────────────────────────────

/** List all skill rows from the registry table. */
export function listSkillRows(db: Db) {
  return db.select().from(skills).all();
}

/** Upsert a skill bundle into the registry. */
export function upsertSkillBundle(db: Db, bundle: SkillBundle): void {
  const ts = now();
  const filesJson = JSON.stringify(bundle.files);
  const existing = db.select().from(skills).where(eq(skills.name, bundle.name)).get();
  if (existing) {
    db.update(skills).set({ filesJson, updatedAt: ts }).where(eq(skills.name, bundle.name)).run();
  } else {
    db.insert(skills).values({ name: bundle.name, filesJson, createdAt: ts, updatedAt: ts }).run();
  }
}

// ─── Registry: Agent-Skill links ──────────────────────────────────────────

/** Replace all skill links for an agent (delete+reinsert). */
export function replaceAgentSkillLinks(db: Db, agentId: string, skillNames: string[]): void {
  db.delete(agentSkills).where(eq(agentSkills.agentId, agentId)).run();
  const ts = now();
  for (const skillName of skillNames) {
    db.insert(agentSkills).values({ agentId, skillName, createdAt: ts }).run();
  }
}

/** Get skill names linked to an agent. */
export function getAgentSkillNames(db: Db, agentId: string): string[] {
  return db
    .select({ skillName: agentSkills.skillName })
    .from(agentSkills)
    .where(eq(agentSkills.agentId, agentId))
    .all()
    .map((r) => r.skillName);
}

// ─── Registry: Loaders (DB → runtime maps) ────────────────────────────────

/** Load all agents from DB into a Map<id, AgentConfig>. */
export function loadAgentConfigsFromDb(db: Db): Map<string, AgentConfig> {
  const map = new Map<string, AgentConfig>();
  for (const row of listAgentRows(db)) {
    const tools = row.toolsJson ? (JSON.parse(row.toolsJson) as string[]) : undefined;
    const skillNames = getAgentSkillNames(db, row.id);
    const config = AgentConfig.parse({
      id: row.id,
      name: row.name,
      model: row.model,
      systemPrompt: row.systemPrompt,
      ...(tools ? { tools } : {}),
      ...(skillNames.length ? { skills: skillNames } : {}),
    });
    map.set(config.id, config);
  }
  return map;
}

/** Load all skills from DB into a Map<name, SkillBundle>. */
export function loadSkillBundlesFromDb(db: Db): Map<string, SkillBundle> {
  const map = new Map<string, SkillBundle>();
  for (const row of listSkillRows(db)) {
    const files = JSON.parse(row.filesJson) as { path: string; contents: string }[];
    const bundle = SkillBundle.parse({ name: row.name, files });
    map.set(bundle.name, bundle);
  }
  return map;
}

/** Seed file-based configs into the DB (insert-if-missing semantics). */
export function seedRegistryFromConfig(
  db: Db,
  fileAgents: Map<string, AgentConfig>,
  fileSkills: Map<string, SkillBundle>,
): void {
  for (const bundle of fileSkills.values()) {
    const existing = db.select().from(skills).where(eq(skills.name, bundle.name)).get();
    if (!existing) upsertSkillBundle(db, bundle);
  }
  for (const config of fileAgents.values()) {
    const existing = db.select().from(agents).where(eq(agents.id, config.id)).get();
    if (!existing) {
      upsertAgentConfig(db, config);
      if (config.skills?.length) replaceAgentSkillLinks(db, config.id, config.skills);
    }
  }
}
