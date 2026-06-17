import { type InvocationRequest, InvocationResult } from "@gilly/harness-protocol";
import type { RuntimeProvider } from "./provider.ts";

/**
 * Runs the harness over HTTP using the AgentCore container contract
 * (`POST /invocations`, `GET /ping`). For local dev the harness is just a
 * process/container at `harnessUrl`; the same contract later targets AgentCore.
 */
export class LocalRuntimeProvider implements RuntimeProvider {
  readonly name = "local";

  constructor(private readonly harnessUrl: string) {}

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    const res = await fetch(`${this.harnessUrl}/invocations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`harness ${res.status}: ${await res.text()}`);
    return InvocationResult.parse(await res.json());
  }

  async healthy(): Promise<boolean> {
    try {
      return (await fetch(`${this.harnessUrl}/ping`)).ok;
    } catch {
      return false;
    }
  }
}
