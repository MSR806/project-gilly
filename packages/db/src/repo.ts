import type { Run, Session } from "@gilly/core";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { followUps, runs, sessions } from "./schema.ts";

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

/** Queue a follow-up received while a run was active. */
export function enqueueFollowUp(db: Db, sessionId: string, input: string): void {
  db.insert(followUps)
    .values({ id: crypto.randomUUID(), sessionId, input, createdAt: now() })
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
