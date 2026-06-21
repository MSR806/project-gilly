import { AgentConfig, WorkspaceRef } from "@gilly/core";
import { z } from "zod";

/** Control plane → harness: everything needed to drive one loop. The stable handoff. */
export const InvocationRequest = z.object({
  agent: AgentConfig,
  /** The task for this invocation (Slack message, cron payload, …). */
  userMessage: z.string(),
  /** Resume a prior harness session (follow-up); omit to start fresh. */
  resumeSessionId: z.string().optional(),
  /** Workspace to mount, when the runtime persists one. */
  workspace: WorkspaceRef.optional(),
});
export type InvocationRequest = z.infer<typeof InvocationRequest>;

/** Harness → control plane: the structured result of one loop. */
export const InvocationResult = z.object({
  status: z.enum(["completed", "error"]),
  /** Final assistant text to deliver. */
  finalText: z.string(),
  /** Harness session id, stored on the Session to resume follow-ups. */
  harnessSessionId: z.string().nullable(),
  error: z.string().nullable(),
});
export type InvocationResult = z.infer<typeof InvocationResult>;

/** AgentCore `GET /ping` health response. */
export const PingResult = z.object({ status: z.literal("Healthy") });
export type PingResult = z.infer<typeof PingResult>;

/** A streamed invocation: incremental `token`s and `tool` calls, then a terminal `done` or `error`. */
export const StreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    /** Tool name, e.g. "Bash", "Read", "Edit". */
    name: z.string(),
    /** Short human-readable summary of the call's input (path, command, …); may be empty. */
    summary: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    finalText: z.string(),
    harnessSessionId: z.string().nullable(),
  }),
  z.object({ type: z.literal("error"), error: z.string() }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;
