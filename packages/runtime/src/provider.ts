import type { InvocationRequest, InvocationResult } from "@gilly/harness-protocol";

/**
 * The control plane → runtime seam. Swappable by design: LocalRuntimeProvider today,
 * AgentCoreRuntimeProvider later — nothing above this interface changes.
 */
export interface RuntimeProvider {
  readonly name: string;
  /** Lease a box, run the harness loop inside it, return its structured result. */
  invoke(req: InvocationRequest): Promise<InvocationResult>;
  /** True when the runtime + harness are reachable. */
  healthy(): Promise<boolean>;
}
