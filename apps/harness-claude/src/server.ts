import { InvocationRequest } from "@gilly/harness-protocol";
import type { HarnessDriver } from "./driver.ts";
import { runAgentLoop, streamAgentLoop } from "./loop.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * AgentCore HTTP contract: `GET /ping` health, `POST /invocations` to drive a loop,
 * `POST /invocations/stream` for NDJSON token streaming.
 *
 * Accepts either a `HarnessDriver` or the legacy `runLoop`/`runStream` functions.
 * The HTTP contract is unchanged regardless of which driver backs the server.
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

/** Creates a server backed by a HarnessDriver instance. */
export function createServerFromDriver(driver: HarnessDriver) {
  return createServer(
    (req) => driver.invoke(req),
    (req) => driver.invokeStream(req),
  );
}
