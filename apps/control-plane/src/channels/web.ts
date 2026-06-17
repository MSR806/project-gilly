import type { AgentConfig } from "@gilly/core";
import type { createEngine } from "../engine.ts";
import type { Channel } from "./channel.ts";

// Permissive CORS so the UI can call the API directly in dev (Next also proxies /api).
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });

/**
 * Web channel + the seed of the control-plane management API. Serves the UI's
 * HTTP endpoints over `Bun.serve`. Today read-only agent listing; chat (SSE) and
 * agent/skill/MCP/connection CRUD layer on here later.
 */
export function createWebChannel(deps: {
  engine: ReturnType<typeof createEngine>;
  agents: Map<string, AgentConfig>;
  port: number;
}): Channel {
  async function fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    if (req.method === "GET" && pathname === "/api/agents") {
      const list = [...deps.agents.values()].map(({ id, name, model }) => ({ id, name, model }));
      return json(list);
    }

    if (req.method === "POST" && pathname === "/api/chat") {
      return chat(req, deps.engine);
    }

    return json({ error: "not found" }, 404);
  }

  return {
    name: "web",
    start: async () => {
      Bun.serve({ port: deps.port, fetch });
      console.log(`web API listening on :${deps.port}`);
    },
  };
}

/** POST /api/chat → Server-Sent Events of StreamEvents; reuses a conversation via id. */
async function chat(
  req: Request,
  engine: { stream: (input: ChatStreamInput) => AsyncIterable<unknown> },
): Promise<Response> {
  let body: { agentId?: string; message?: string; conversationId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!body.agentId || !body.message) return json({ error: "agentId and message required" }, 400);

  const conversationId = body.conversationId ?? crypto.randomUUID();
  const events = engine.stream({
    agentId: body.agentId,
    source: "web",
    sourceKey: `web:${conversationId}`,
    userMessage: body.message,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (e) {
        const error = { type: "error", error: String(e) };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(error)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-conversation-id": conversationId,
      ...cors,
    },
  });
}

type ChatStreamInput = { agentId: string; source: string; sourceKey: string; userMessage: string };
