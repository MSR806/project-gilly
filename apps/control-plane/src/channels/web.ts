import { AgentConfig } from "@gilly/core";
import { createAgent, type Db, deleteAgent, getAgent, listAgents, updateAgent } from "@gilly/db";
import type { createEngine } from "../engine.ts";
import type { SkillStore } from "../stores/skill-store.ts";
import type { Channel } from "./channel.ts";

// Permissive CORS so the UI can call the API directly in dev (Next also proxies /api).
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });

/** Parse a JSON request body, returning a 400 Response instead of throwing on bad input. */
async function readJson(req: Request): Promise<{ body: unknown } | { error: Response }> {
  try {
    return { body: await req.json() };
  } catch {
    return { error: json({ error: "invalid JSON body" }, 400) };
  }
}

/** Map a store/repo error to the right status by its message; defaults to 400. */
function errorResponse(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  const status = /already exists/.test(message) ? 409 : /not found/.test(message) ? 404 : 400;
  return json({ error: message }, status);
}

/**
 * Web channel + the control-plane management API over `Bun.serve`: agent CRUD (DB-backed), skill
 * CRUD (the {@link SkillStore} seam), and chat (SSE). The UI talks to these endpoints.
 */
export function createWebChannel(deps: {
  engine: ReturnType<typeof createEngine>;
  db: Db;
  skillStore: SkillStore;
  port: number;
}): Channel {
  const { db, skillStore } = deps;

  async function fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const { method } = req;
    if (method === "OPTIONS") return new Response(null, { headers: cors });

    // --- Agents ---
    if (pathname === "/api/agents") {
      if (method === "GET") {
        return json(listAgents(db).map(({ id, name, model }) => ({ id, name, model })));
      }
      if (method === "POST") return createAgentRoute(req);
    }
    const agentId = pathParam(pathname, "/api/agents/");
    if (agentId) {
      if (method === "GET") {
        const agent = getAgent(db, agentId);
        return agent ? json(agent) : json({ error: `Agent "${agentId}" not found` }, 404);
      }
      if (method === "PUT") return updateAgentRoute(req, agentId);
      if (method === "DELETE") {
        deleteAgent(db, agentId);
        return json({ ok: true });
      }
    }

    // --- Skills ---
    if (pathname === "/api/skills") {
      if (method === "GET") return json(skillStore.list());
      if (method === "POST") return createSkillRoute(req);
    }
    const skillName = pathParam(pathname, "/api/skills/");
    if (skillName) {
      if (method === "GET") {
        const detail = skillStore.detail(skillName);
        return detail ? json(detail) : json({ error: `Skill "${skillName}" not found` }, 404);
      }
      if (method === "PUT") return updateSkillRoute(req, skillName);
      if (method === "DELETE") {
        skillStore.delete(skillName);
        return json({ ok: true });
      }
    }

    if (method === "POST" && pathname === "/api/chat") return chat(req, deps.engine);

    return json({ error: "not found" }, 404);
  }

  async function createAgentRoute(req: Request): Promise<Response> {
    const parsed = await readJson(req);
    if ("error" in parsed) return parsed.error;
    const cfg = AgentConfig.safeParse(parsed.body);
    if (!cfg.success) return json({ error: cfg.error.message }, 400);
    const unknown = unknownSkills(cfg.data);
    if (unknown.length) return json({ error: `Unknown skill(s): ${unknown.join(", ")}` }, 400);
    try {
      return json(createAgent(db, cfg.data), 201);
    } catch (e) {
      return errorResponse(e);
    }
  }

  async function updateAgentRoute(req: Request, id: string): Promise<Response> {
    const parsed = await readJson(req);
    if ("error" in parsed) return parsed.error;
    const cfg = AgentConfig.safeParse({ ...(parsed.body as object), id });
    if (!cfg.success) return json({ error: cfg.error.message }, 400);
    const unknown = unknownSkills(cfg.data);
    if (unknown.length) return json({ error: `Unknown skill(s): ${unknown.join(", ")}` }, 400);
    try {
      return json(updateAgent(db, id, cfg.data));
    } catch (e) {
      return errorResponse(e);
    }
  }

  async function createSkillRoute(req: Request): Promise<Response> {
    const fields = await readSkillFields(req);
    if ("error" in fields) return fields.error;
    try {
      skillStore.create(fields.value);
      return json({ name: fields.value.name }, 201);
    } catch (e) {
      return errorResponse(e);
    }
  }

  async function updateSkillRoute(req: Request, name: string): Promise<Response> {
    const fields = await readSkillFields(req, name);
    if ("error" in fields) return fields.error;
    try {
      skillStore.update(name, fields.value);
      return json({ name });
    } catch (e) {
      return errorResponse(e);
    }
  }

  /** Skills referenced by an agent that the store doesn't know — surfaced as a 400 up front. */
  function unknownSkills(cfg: AgentConfig): string[] {
    return (cfg.skills ?? []).filter((name) => !skillStore.get(name));
  }

  return {
    name: "web",
    start: async () => {
      Bun.serve({ port: deps.port, fetch });
      console.log(`web API listening on :${deps.port}`);
    },
  };
}

/** Return the trailing segment if `pathname` is `prefix<segment>` with no further slashes. */
function pathParam(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  const rest = pathname.slice(prefix.length);
  return rest && !rest.includes("/") ? decodeURIComponent(rest) : undefined;
}

type SkillInput = { name: string; description: string; content: string };

/** Validate a skill request body. `name` is taken from the path on update (body name ignored). */
async function readSkillFields(
  req: Request,
  name?: string,
): Promise<{ value: SkillInput } | { error: Response }> {
  const parsed = await readJson(req);
  if ("error" in parsed) return parsed;
  const body = parsed.body as Partial<SkillInput>;
  const value = {
    name: name ?? body.name ?? "",
    description: body.description ?? "",
    content: body.content ?? "",
  };
  if (!value.name || !value.description || !value.content) {
    return { error: json({ error: "name, description and content are required" }, 400) };
  }
  return { value };
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
