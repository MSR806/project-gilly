import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";

/**
 * The harness driver seam: each driver knows how to drive one agent loop to completion.
 * Claude SDK is the default; ACP adds a protocol-agnostic driver that spawns an
 * ACP-compatible agent command over stdio JSON-RPC.
 */
export interface HarnessDriver {
  readonly name: string;
  invoke(req: InvocationRequest): Promise<InvocationResult>;
  invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent>;
}
