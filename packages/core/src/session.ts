/** Lifecycle of a single execution attempt. */
export type RunStatus = "running" | "completed" | "error";

/** Durable context for one conversation / unit of work (one Slack thread = one Session). */
export type Session = {
  id: string;
  agentId: string;
  /** Origin surface, e.g. "slack". */
  source: string;
  /** Surface-native conversation key, e.g. "<channel>:<thread_ts>". Unique. */
  sourceKey: string;
  /** Harness session id used to resume the loop; set after the first run. */
  harnessSessionId: string | null;
  createdAt: number;
};

/** One execution attempt within a Session. */
export type Run = {
  id: string;
  sessionId: string;
  status: RunStatus;
  /** User message that started this run. */
  input: string;
  /** Final agent message, when completed. */
  output: string | null;
  error: string | null;
  createdAt: number;
};

/** A user message received while a run was active; replayed FIFO when the run finishes. */
export type FollowUp = {
  id: string;
  sessionId: string;
  input: string;
  createdAt: number;
};
