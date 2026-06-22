import { query } from "@anthropic-ai/claude-agent-sdk";
import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
import type { HarnessDriver } from "./driver.ts";
import { runAgentLoop, streamAgentLoop } from "./loop.ts";

/**
 * HarnessDriver backed by the Claude Agent SDK.
 * Delegates to the existing `runAgentLoop` / `streamAgentLoop` functions
 * which handle all SDK option assembly, workspace setup, and error wrapping.
 */
export class ClaudeSdkHarnessDriver implements HarnessDriver {
  readonly name = "claude-sdk";
  private readonly queryFn: typeof query;

  constructor(queryFn: typeof query = query) {
    this.queryFn = queryFn;
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    return runAgentLoop(req, this.queryFn);
  }

  async *invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent> {
    yield* streamAgentLoop(req, this.queryFn);
  }
}
