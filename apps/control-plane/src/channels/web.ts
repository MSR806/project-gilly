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
