import { AgentConfig } from "@gilly/core";
import { type Db, replaceAgentSkillLinks, upsertAgentConfig, upsertSkillBundle } from "@gilly/db";
import type { SkillBundle } from "@gilly/harness-protocol";
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
 * Web channel + the control-plane management API. Serves the UI's HTTP
 * endpoints over `Bun.serve`: agent/skill listing, creation, and SSE chat.
 */
export function createWebChannel(deps: {
  engine: ReturnType<typeof createEngine>;
  agents: Map<string, AgentConfig>;
  skills: Map<string, SkillBundle>;
  db: Db;
  port: number;
}): Channel {
  async function fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // ─── Agents ────────────────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/agents") {
      const list = [...deps.agents.values()].map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model,
        tools: a.tools ?? [],
        skills: a.skills ?? [],
      }));
      return json(list);
    }

    if (req.method === "POST" && pathname === "/api/agents") {
      return createAgent(req, deps);
    }

    // ─── Skills ────────────────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/skills") {
      const list = [...deps.skills.values()].map((s) => ({
        name: s.name,
        preview: s.files.find((f) => f.path === "SKILL.md")?.contents.slice(0, 200) ?? "",
      }));
      return json(list);
    }

    if (req.method === "POST" && pathname === "/api/skills") {
      return createSkill(req, deps);
    }

    // ─── Chat ──────────────────────────────────────────────────────────
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

// ─── POST /api/agents ──────────────────────────────────────────────────────

async function createAgent(
  req: Request,
  deps: { agents: Map<string, AgentConfig>; skills: Map<string, SkillBundle>; db: Db },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const parsed = AgentConfig.safeParse(body);
  if (!parsed.success) {
    return json({ error: "validation failed", details: parsed.error.format() }, 400);
  }
  const config = parsed.data;

  // Reject duplicates (create semantics, not upsert).
  if (deps.agents.has(config.id)) {
    return json({ error: `Agent "${config.id}" already exists` }, 409);
  }

  // Validate referenced skills exist.
  for (const name of config.skills ?? []) {
    if (!deps.skills.has(name)) {
      return json({ error: `Referenced skill "${name}" does not exist` }, 400);
    }
  }

  // Persist to SQLite.
  upsertAgentConfig(deps.db, config);
  if (config.skills?.length) {
    replaceAgentSkillLinks(deps.db, config.id, config.skills);
  }

  // Update mutable map so engine picks it up immediately.
  deps.agents.set(config.id, config);

  return json(
    {
      id: config.id,
      name: config.name,
      model: config.model,
      tools: config.tools ?? [],
      skills: config.skills ?? [],
    },
    201,
  );
}

// ─── POST /api/skills ──────────────────────────────────────────────────────

async function createSkill(
  req: Request,
  deps: { skills: Map<string, SkillBundle>; db: Db },
): Promise<Response> {
  let body: { name?: string; content?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return json({ error: "name is required" }, 400);
  }
  if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
    return json({ error: "content is required" }, 400);
  }

  const name = body.name.trim();
  if (deps.skills.has(name)) {
    return json({ error: `Skill "${name}" already exists` }, 409);
  }

  const bundle: SkillBundle = { name, files: [{ path: "SKILL.md", contents: body.content }] };

  // Persist to SQLite.
  upsertSkillBundle(deps.db, bundle);

  // Update mutable map.
  deps.skills.set(name, bundle);

  return json({ name, preview: body.content.slice(0, 200) }, 201);
}

// ─── POST /api/chat ────────────────────────────────────────────────────────

/** POST /api/chat -> Server-Sent Events of StreamEvents; reuses a conversation via id. */
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
