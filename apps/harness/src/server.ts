import {
  InvocationRequest,
  type InvocationResult,
  type StreamEvent,
} from "@gilly/harness-protocol";
import {
  runAgentLoop as runClaudeAgentLoop,
  streamAgentLoop as streamClaudeAgentLoop,
} from "./harness-claude/loop.ts";
import {
  runAgentLoop as runOpenAiAgentLoop,
  streamAgentLoop as streamOpenAiAgentLoop,
} from "./harness-openai/loop.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type RunLoop = (request: InvocationRequest) => Promise<InvocationResult>;
type RunStream = (request: InvocationRequest, signal?: AbortSignal) => AsyncIterable<StreamEvent>;

export type HarnessRunners = Record<"claude" | "codex", { runLoop: RunLoop; runStream: RunStream }>;

const defaultRunners: HarnessRunners = {
  claude: {
    runLoop: runClaudeAgentLoop,
    runStream: (request, signal) => streamClaudeAgentLoop(request, undefined, signal),
  },
  codex: {
    runLoop: runOpenAiAgentLoop,
    runStream: (request, signal) => streamOpenAiAgentLoop(request, undefined, signal),
  },
};

/** AgentCore HTTP boundary that dispatches each request to its explicitly selected harness. */
export function createServer(runners: HarnessRunners = defaultRunners) {
  return {
    async fetch(req: Request): Promise<Response> {
      const { pathname } = new URL(req.url);

      if (req.method === "GET" && pathname === "/ping") {
        return json({ status: "Healthy" });
      }

      if (req.method === "POST" && pathname === "/invocations") {
        const parsed = await parseRequest(req);
        if (parsed instanceof Response) return parsed;
        const runner = runnerFor(runners, parsed.agent.harness.id);
        if (runner instanceof Response) return runner;
        return json(await runner.runLoop(parsed));
      }

      if (req.method === "POST" && pathname === "/invocations/stream") {
        const parsed = await parseRequest(req);
        if (parsed instanceof Response) return parsed;

        const encoder = new TextEncoder();
        const abort = new AbortController();
        const runner = runnerFor(runners, parsed.agent.harness.id);
        if (runner instanceof Response) return runner;
        const iterator = runner.runStream(parsed, abort.signal)[Symbol.asyncIterator]();
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await iterator.next();
              if (next.done) {
                controller.close();
                return;
              }
              controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
            } catch (error) {
              controller.error(error);
            }
          },
          async cancel() {
            abort.abort();
            await iterator.return?.();
          },
        });
        return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
      }

      return json({ error: "not found" }, 404);
    },
  };
}

function runnerFor(runners: HarnessRunners, id: string) {
  if (id !== "claude" && id !== "codex") {
    return json({ error: `Unknown harness runner: "${id}"` }, 400);
  }
  return runners[id];
}

async function parseRequest(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const parsed = InvocationRequest.safeParse(body);
  return parsed.success ? parsed.data : json({ error: parsed.error.message }, 400);
}
