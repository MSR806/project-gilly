import { InvocationRequest } from "@gilly/harness-protocol";
import type { HarnessDriver } from "./driver.ts";
import { runAgentLoop, streamAgentLoop } from "./loop.ts";

type RunLoop = (req: InvocationRequest) => ReturnType<HarnessDriver["invoke"]>;
type RunStream = (req: InvocationRequest) => ReturnType<HarnessDriver["invokeStream"]>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * AgentCore HTTP contract: `GET /ping` health, `POST /invocations` to drive a loop,
 * `POST /invocations/stream` for NDJSON token streaming.
 *
 * Accepts either a HarnessDriver or raw loop/stream functions (backward-compatible for
 * tests that stub the SDK out directly).
 */
export function createServer(runLoopOrDriver?: RunLoop | HarnessDriver, runStream?: RunStream) {
  let invoke: RunLoop;
  let stream: RunStream;

  if (runLoopOrDriver && "invoke" in runLoopOrDriver && "invokeStream" in runLoopOrDriver) {
    // HarnessDriver passed
    const driver = runLoopOrDriver;
    invoke = (req) => driver.invoke(req);
    stream = (req) => driver.invokeStream(req);
  } else {
    invoke = (runLoopOrDriver as RunLoop | undefined) ?? runAgentLoop;
    stream = runStream ?? streamAgentLoop;
  }

  return {
    async fetch(req: Request): Promise<Response> {
      const { pathname } = new URL(req.url);

      if (req.method === "GET" && pathname === "/ping") {
        return json({ status: "Healthy" });
      }

      if (req.method === "POST" && pathname === "/invocations") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        const parsed = InvocationRequest.safeParse(body);
        if (!parsed.success) return json({ error: parsed.error.message }, 400);
        return json(await invoke(parsed.data));
      }

      if (req.method === "POST" && pathname === "/invocations/stream") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        const parsed = InvocationRequest.safeParse(body);
        if (!parsed.success) return json({ error: parsed.error.message }, 400);

        const encoder = new TextEncoder();
        const readable = new ReadableStream<Uint8Array>({
          async start(controller) {
            for await (const event of stream(parsed.data)) {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            }
            controller.close();
          },
        });
        return new Response(readable, {
          headers: { "content-type": "application/x-ndjson" },
        });
      }

      return json({ error: "not found" }, 404);
    },
  };
}
