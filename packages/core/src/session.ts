import { z } from "zod";

/** Lifecycle of a single execution attempt. */
export const RunStatus = z.enum(["running", "completed", "error"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** Durable context for one conversation / unit of work (one Slack thread = one Session). */
export const Session = z.object({
  id: z.string(),
  agentId: z.string(),
  /** Origin surface, e.g. "slack". */
  source: z.string(),
  /** Surface-native conversation key, e.g. "<channel>:<thread_ts>". Unique. */
  sourceKey: z.string(),
  /** Harness session id used to resume the loop; set after the first run. */
  harnessSessionId: z.string().nullable(),
  createdAt: z.number(),
});
export type Session = z.infer<typeof Session>;

/** One execution attempt within a Session. */
export const Run = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: RunStatus,
  /** User message that started this run. */
  input: z.string(),
  /** Final agent message, when completed. */
  output: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
});
export type Run = z.infer<typeof Run>;

/** A user message received while a run was active; replayed FIFO when the run finishes. */
export const FollowUp = z.object({
  id: z.string(),
  sessionId: z.string(),
  input: z.string(),
  createdAt: z.number(),
});
export type FollowUp = z.infer<typeof FollowUp>;
