import { type InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
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

  /** Reads the harness's NDJSON stream (one StreamEvent JSON per line). */
  async *invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent> {
    const res = await fetch(`${this.harnessUrl}/invocations/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok || !res.body) throw new Error(`harness ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield StreamEvent.parse(JSON.parse(line));
      }
    }
    const rest = buffer.trim();
    if (rest) yield StreamEvent.parse(JSON.parse(rest));
  }

  async healthy(): Promise<boolean> {
    try {
      return (await fetch(`${this.harnessUrl}/ping`)).ok;
    } catch {
      return false;
    }
  }
}
