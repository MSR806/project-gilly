import { InvocationRequest } from "@gilly/harness-protocol";
import { runAgentLoop, streamAgentLoop } from "./loop.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * AgentCore HTTP contract: `GET /ping` health, `POST /invocations` to drive a loop,
 * `POST /invocations/stream` for NDJSON token streaming.
 * `runLoop`/`runStream` are injectable so tests can stub the SDK out.
 */
export function createServer(runLoop = runAgentLoop, runStream = streamAgentLoop) {
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
        // Loop errors are reported as a 200 InvocationResult with status "error".
        return json(await runLoop(parsed.data));
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
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for await (const event of runStream(parsed.data)) {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            }
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
      }

      return json({ error: "not found" }, 404);
    },
  };
}
