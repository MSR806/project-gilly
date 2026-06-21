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

  /**
   * POST to a harness endpoint, turning transport failures into a clear message. A failed
   * connect (harness not running/reachable) and a non-2xx response both surface as a
   * user-meaningful error rather than a raw undici "Unable to connect" string.
   */
  private async post(path: string, req: InvocationRequest): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.harnessUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch (e) {
      console.warn(`[runtime] cannot reach harness at ${this.harnessUrl}:`, String(e));
      throw new Error(
        `The agent runtime is unavailable — couldn't reach the harness at ${this.harnessUrl}. Is it running?`,
      );
    }
    if (!res.ok) throw new Error(`The agent runtime returned an error (HTTP ${res.status}).`);
    return res;
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    const res = await this.post("/invocations", req);
    return InvocationResult.parse(await res.json());
  }

  /** Reads the harness's NDJSON stream (one StreamEvent JSON per line). */
  async *invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent> {
    const res = await this.post("/invocations/stream", req);
    if (!res.body) throw new Error("The agent runtime returned no response stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
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
    } catch (e) {
      console.warn(`[runtime] harness stream dropped at ${this.harnessUrl}:`, String(e));
      throw new Error("Lost connection to the agent runtime mid-response. Please try again.");
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
