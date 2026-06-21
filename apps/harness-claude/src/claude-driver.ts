import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
import type { HarnessDriver } from "./driver.ts";
import { runAgentLoop, streamAgentLoop } from "./loop.ts";

/** Wraps the existing Claude Agent SDK loop as a HarnessDriver. */
export class ClaudeDriver implements HarnessDriver {
  readonly name = "claude";

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    return runAgentLoop(req);
  }

  async *invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent> {
    yield* streamAgentLoop(req);
  }
}
