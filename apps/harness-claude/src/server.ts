import { InvocationRequest } from "@gilly/harness-protocol";
import { runAgentLoop } from "./loop.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * AgentCore HTTP contract: `GET /ping` health, `POST /invocations` to drive a loop.
 * `runLoop` is injectable so tests can stub the SDK out.
 */
export function createServer(runLoop = runAgentLoop) {
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

      return json({ error: "not found" }, 404);
    },
  };
}
