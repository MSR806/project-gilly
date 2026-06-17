import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
import type { RuntimeProvider } from "./provider.ts";

/**
 * Placeholder for the AWS Bedrock AgentCore provider. The harness image is
 * unchanged — only the transport differs (AWS `InvokeAgentRuntime` vs. local HTTP).
 * Out of MVP scope; kept to assert the seam exists.
 */
export class AgentCoreRuntimeProvider implements RuntimeProvider {
  readonly name = "agentcore";

  invoke(_req: InvocationRequest): Promise<InvocationResult> {
    throw new Error("AgentCoreRuntimeProvider is not implemented in the MVP");
  }

  invokeStream(_req: InvocationRequest): AsyncIterable<StreamEvent> {
    throw new Error("AgentCoreRuntimeProvider is not implemented in the MVP");
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
