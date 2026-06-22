import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";

/**
 * Stable seam between the harness HTTP server and the agent loop implementation.
 * The server drives one of these; which one is chosen by config/env at boot.
 */
export interface HarnessDriver {
  /** Human-readable name for logging / diagnostics. */
  readonly name: string;

  /** Run a full invocation to completion. Never throws — errors surface in the result. */
  invoke(req: InvocationRequest): Promise<InvocationResult>;

  /** Stream incremental events for one invocation. Never throws — errors are yielded. */
  invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent>;
}
