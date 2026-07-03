import { AgentConfig } from "@gilly/core";
import {
  addGrant,
  createAgent,
  type Db,
  deleteAgent,
  deleteGrant,
  getAgent,
  listAgents,
  listGrants,
  listUsers,
  updateAgent,
} from "@gilly/db";
import { z } from "zod";
import type { createEngine, MessageInput } from "../engine.ts";
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

type WebDeps = {
  engine: ReturnType<typeof createEngine>;
  db: Db;
  skillStore: SkillStore;
  port: number;
  /** Tooling gateway base URL; proxied by GET /api/connectors so the UI can list connectors. */
  gatewayUrl?: string;
  /** Gateway admin token; injected server-side so the browser never handles it. */
  adminToken?: string;
};

/** The web management API as a port-free `fetch` handler, so tests can drive it directly. */
export function createWebHandler(deps: WebDeps): (req: Request) => Promise<Response> {
  const { db, skillStore, gatewayUrl, adminToken } = deps;

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

    // --- Users & grants (admin; unauthenticated for now — writes are gated on the gateway) ---
    if (method === "GET" && pathname === "/api/users") {
      return json(
        listUsers(db).map(({ id, slackUserId, name, isAdmin }) => ({
          id,
          slackUserId,
          name,
          isAdmin,
        })),
      );
    }
    const grantsUserId = pathParam(pathname, "/api/users/", "/grants");
    if (grantsUserId && method === "GET") return json(listGrants(db, grantsUserId));
    if (method === "POST" && pathname === "/api/grants") return createGrantRoute(req);
    const grantId = pathParam(pathname, "/api/grants/");
    if (grantId && method === "DELETE") {
      deleteGrant(db, grantId);
      return json({ ok: true });
    }

    // Proxy the gateway's connector catalog so the UI can populate an agent's connectors list.
    if (method === "GET" && pathname === "/api/connectors") {
      if (!gatewayUrl) return json({ connectors: [] });
      try {
        const res = await globalThis.fetch(`${gatewayUrl}/connectors`);
        return json(await res.json());
      } catch {
        return json({ connectors: [] });
      }
    }

    // Admin connector auth. The browser calls these WITHOUT any secret; we inject x-admin-token
    // when calling the gateway so the token never reaches the client.
    const credProvider = pathParam(pathname, "/api/connectors/", "/credentials");
    if (method === "PUT" && credProvider) return saveCredential(req, credProvider);
    const connectProvider = pathParam(pathname, "/api/connectors/", "/connect");
    if (method === "GET" && connectProvider) return startConnect(connectProvider);

    if (method === "POST" && pathname === "/api/chat") return chat(req, deps.engine);

    return json({ error: "not found" }, 404);
  }

  /** PUT /api/connectors/:provider/credentials — inject x-admin-token, forward the {key,value} body. */
  async function saveCredential(req: Request, provider: string): Promise<Response> {
    if (!gatewayUrl || !adminToken) return json({ error: "gateway not configured" }, 503);
    try {
      const res = await globalThis.fetch(`${gatewayUrl}/admin/credentials/${provider}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-admin-token": adminToken },
        body: await req.text(),
      });
      return json(await res.json(), res.status);
    } catch (e) {
      return errorResponse(e);
    }
  }

  /**
   * GET /api/connectors/:provider/connect — start the OAuth flow. We call the gateway with the admin
   * token; a 302 carries the Atlassian consent URL, which we relay to the browser so it navigates
   * there. A 200 means already-connected → bounce back to the connectors page.
   */
  async function startConnect(provider: string): Promise<Response> {
    if (!gatewayUrl || !adminToken) return json({ error: "gateway not configured" }, 503);
    try {
      const res = await globalThis.fetch(`${gatewayUrl}/oauth/${provider}/start`, {
        redirect: "manual",
        headers: { "x-admin-token": adminToken },
      });
      const location =
        res.status === 302
          ? res.headers.get("location")
          : `/connectors?connected=${encodeURIComponent(provider)}`;
      if (!location) return json({ error: "gateway returned no redirect" }, 502);
      return new Response(null, { status: 302, headers: { location, ...cors } });
    } catch (e) {
      return errorResponse(e);
    }
  }

  async function createGrantRoute(req: Request): Promise<Response> {
    const parsed = await readJson(req);
    if ("error" in parsed) return parsed.error;
    const body = z
      .object({ userId: z.string().min(1), toolPattern: z.string().min(1) })
      .safeParse(parsed.body);
    if (!body.success) return json({ error: body.error.message }, 400);
    try {
      return json(addGrant(db, body.data.userId, body.data.toolPattern), 201);
    } catch (e) {
      return errorResponse(e);
    }
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

  return fetch;
}

/**
 * Web channel + the control-plane management API over `Bun.serve`: agent CRUD (DB-backed), skill
 * CRUD (the {@link SkillStore} seam), and chat (SSE). The UI talks to these endpoints.
 */
export function createWebChannel(deps: WebDeps): Channel {
  const fetch = createWebHandler(deps);
  return {
    name: "web",
    start: async () => {
      Bun.serve({ port: deps.port, fetch });
      console.log(`web API listening on :${deps.port}`);
    },
  };
}

/**
 * Return the segment if `pathname` is `prefix<segment>suffix` (suffix defaults to ""), where
 * `<segment>` has no slashes. `pathParam(p, "/api/connectors/", "/credentials")` → the provider.
 */
function pathParam(pathname: string, prefix: string, suffix = ""): string | undefined {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
  const rest = pathname.slice(prefix.length, pathname.length - suffix.length);
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
  engine: { stream: (input: MessageInput) => AsyncIterable<unknown> },
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
