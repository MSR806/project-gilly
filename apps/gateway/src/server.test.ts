import { expect, test } from "bun:test";
import { createDb, createGatewayToken, getCredential, schema, setCredential } from "@gilly/db";
import { type McpGateway, NotConnectedError } from "./mcp.ts";
import { createGatewayServer } from "./server.ts";
import { makeVault } from "./vault.ts";

const ADMIN = "admin-secret";

/** Build a fresh in-memory gateway with a token carrying connectors and grants. */
function setup(
  grants: string[],
  opts: {
    connectors?: string[];
    ttlMs?: number;
    mcp?: McpGateway;
    catalogTimeoutMs?: number;
  } = {},
) {
  const db = createDb(":memory:");
  const vault = makeVault("k");
  const fetch = createGatewayServer({
    db,
    vault,
    adminToken: ADMIN,
    mcp: opts.mcp,
    catalogTimeoutMs: opts.catalogTimeoutMs,
  });
  const token = createGatewayToken(db, {
    runId: "run-1",
    userId: "user-1",
    agentId: "agent-1",
    connectors: opts.connectors ?? [...new Set(grants.map((grant) => grant.split(".")[0] ?? ""))],
    grants,
    ttlMs: opts.ttlMs ?? 60_000,
  });
  return { db, fetch, token, vault };
}

/** A fake MCP backend: one static tool, a canned callTool result, optionally throwing. */
function fakeMcp(opts: { throwOnCall?: boolean } = {}): McpGateway {
  return {
    async listTools(connector) {
      return [
        {
          name: `${connector.name}.create_issue`,
          description: "Create an issue",
          inputSchema: { type: "object" },
        },
      ];
    },
    async callTool() {
      if (opts.throwOnCall) throw new Error("boom");
      return { ok: true };
    },
  };
}

const auth = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

const post = (
  fetch: ReturnType<typeof createGatewayServer>,
  path: string,
  headers: Record<string, string>,
  body: unknown,
) => fetch(new Request(`http://x${path}`, { method: "POST", headers, body: JSON.stringify(body) }));

type Agent = {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  tools?: string[];
  skills?: string[];
  connectors?: string[];
};
type Skill = {
  name: string;
  description: string;
  content: string;
  files?: { path: string; contents: string }[];
};
type RunState = {
  id: string;
  status: string;
  steps: (
    | { type: "message"; text: string }
    | { type: "tool"; name: string; summary: string }
    | { type: "error"; error: string }
  )[];
  output?: string;
  runError?: string;
};

async function withControlPlane<T>(
  fn: (state: {
    agents: Map<string, Agent>;
    skills: Map<string, Skill>;
    starts: { id: string; message: string }[];
    runs: Map<string, RunState>;
  }) => Promise<T>,
): Promise<T> {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.GILLY_CONTROL_PLANE_URL;
  const state = {
    agents: new Map<string, Agent>([
      ["coder", { id: "coder", name: "Coder", model: "sonnet", systemPrompt: "code" }],
    ]),
    skills: new Map<string, Skill>([
      ["tooling", { name: "tooling", description: "Use gateway tools.", content: "# Tools" }],
    ]),
    starts: [] as { id: string; message: string }[],
    runs: new Map<string, RunState>(),
  };
  process.env.GILLY_CONTROL_PLANE_URL = "http://control-plane.test";
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "http://control-plane.test") return oldFetch(input, init);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });

    const startAgentId = url.pathname.match(/^\/api\/agents\/([^/]+)\/runs$/)?.[1];
    if (startAgentId && method === "POST") {
      state.starts.push({ id: startAgentId, message: body.message });
      state.runs.set("run-1", { id: "run-1", status: "running", steps: [] });
      return json({ runId: "run-1" }, 202);
    }
    const runId = url.pathname.match(/^\/api\/runs\/([^/]+)$/)?.[1];
    if (runId && method === "GET") {
      return state.runs.has(runId)
        ? json(state.runs.get(runId))
        : json({ error: `Run "${runId}" not found` }, 404);
    }

    const agentId = url.pathname.match(/^\/api\/agents\/([^/]+)$/)?.[1];
    if (url.pathname === "/api/agents" && method === "GET") {
      return json([...state.agents.values()].map(({ id, name, model }) => ({ id, name, model })));
    }
    if (url.pathname === "/api/agents" && method === "POST") {
      state.agents.set(body.id, body);
      return json(body, 201);
    }
    if (agentId && method === "GET") {
      return state.agents.has(agentId)
        ? json(state.agents.get(agentId))
        : json({ error: `Agent "${agentId}" not found` }, 404);
    }
    if (agentId && method === "PUT") {
      state.agents.set(agentId, body);
      return json(body);
    }

    const skillName = url.pathname.match(/^\/api\/skills\/([^/]+)$/)?.[1];
    if (url.pathname === "/api/skills" && method === "GET") {
      return json(
        [...state.skills.values()].map(({ name, description }) => ({ name, description })),
      );
    }
    if (url.pathname === "/api/skills" && method === "POST") {
      state.skills.set(body.name, body);
      return json({ name: body.name }, 201);
    }
    if (skillName && method === "GET") {
      return state.skills.has(skillName)
        ? json(state.skills.get(skillName))
        : json({ error: `Skill "${skillName}" not found` }, 404);
    }
    if (skillName && method === "PUT") {
      state.skills.set(skillName, body);
      return json({ name: skillName });
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;

  try {
    return await fn(state);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.GILLY_CONTROL_PLANE_URL;
    else process.env.GILLY_CONTROL_PLANE_URL = oldUrl;
  }
}

test("catalog returns agent-connected tools only", async () => {
  const { fetch, token } = setup(["echo.*"]);
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string; inputSchema: unknown }[] };
  const names = tools.map((t) => t.name);
  expect(names).toContain("echo.ping");
  expect(names).not.toContain("github.create_issue");
  expect(tools[0]?.inputSchema).toBeDefined();
});

test("catalog includes connected gilly tools", async () => {
  const { fetch, token } = setup(["gilly.*"]);
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string }[] };
  expect(tools.map((t) => t.name)).toContain("gilly.create_agent");
  expect(tools.map((t) => t.name)).toContain("gilly.start_agent");
  expect(tools.map((t) => t.name)).toContain("gilly.get_run");
  expect(tools.map((t) => t.name)).not.toContain("gilly.invoke_agent");
  expect(tools.map((t) => t.name)).toContain("gilly.update_skill");
});

test("gilly.update_agent patches through the control-plane API", async () => {
  await withControlPlane(async ({ agents }) => {
    const { fetch, token } = setup(["gilly.*"]);
    const create = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.create_agent",
      input: {
        id: "helper",
        name: "Helper",
        model: "sonnet",
        systemPrompt: "Help.",
        connectors: ["gilly"],
      },
    });
    expect(await create.json()).toEqual({
      id: "helper",
      name: "Helper",
      model: "sonnet",
      systemPrompt: "Help.",
      connectors: ["gilly"],
    });
    expect(agents.get("helper")?.connectors).toEqual(["gilly"]);

    const res = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.update_agent",
      input: { id: "coder", patch: { name: "Coder 2", connectors: ["gilly"] } },
    });
    expect(await res.json()).toEqual({
      id: "coder",
      name: "Coder 2",
      model: "sonnet",
      systemPrompt: "code",
      connectors: ["gilly"],
    });
    expect(agents.get("coder")?.name).toBe("Coder 2");
  });
});

test("gilly.start_agent and get_run use the control-plane background-run API", async () => {
  await withControlPlane(async ({ runs, starts }) => {
    const { fetch, token } = setup(["gilly.*"]);
    const start = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.start_agent",
      input: { id: "coder", message: "inspect this" },
    });
    expect(await start.json()).toEqual({ runId: "run-1" });
    expect(starts).toEqual([{ id: "coder", message: "inspect this" }]);

    runs.set("run-1", {
      id: "run-1",
      status: "completed",
      steps: [
        { type: "message", text: "Working" },
        {
          type: "tool",
          name: "Bash",
          summary: "bun scripts/metrics.ts branch_cpi --slug t6ypbyjup32s",
        },
      ],
      output: "ran coder",
    });
    const status = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.get_run",
      input: { runId: "run-1" },
    });
    expect(await status.json()).toEqual({
      id: "run-1",
      status: "completed",
      steps: [
        { type: "message", text: "Working" },
        {
          type: "tool",
          name: "Bash",
          summary: "bun scripts/metrics.ts branch_cpi --slug t6ypbyjup32s",
        },
      ],
      output: "ran coder",
    });

    runs.set("run-1", {
      id: "run-1",
      status: "error",
      steps: [{ type: "error", error: "child failed" }],
      runError: "child failed",
    });
    const failed = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.get_run",
      input: { runId: "run-1" },
    });
    expect(await failed.json()).toEqual({
      id: "run-1",
      status: "error",
      steps: [{ type: "error", error: "child failed" }],
      runError: "child failed",
    });
  });
});

test("gilly.create_skill and update_skill write through the control-plane API", async () => {
  await withControlPlane(async ({ skills }) => {
    const { fetch, token } = setup(["gilly.*"]);
    const create = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.create_skill",
      input: {
        name: "agent-admin",
        description: "Manage agents.",
        content: "# Agent Admin",
        files: [{ path: "run.ts", contents: "console.log('go')" }],
      },
    });
    expect(await create.json()).toEqual({ name: "agent-admin" });
    expect(skills.get("agent-admin")?.content).toBe("# Agent Admin");
    expect(skills.get("agent-admin")?.files).toEqual([
      { path: "run.ts", contents: "console.log('go')" },
    ]);

    const update = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.update_skill",
      input: { name: "agent-admin", patch: { description: "Manage Gilly agents." } },
    });
    expect(await update.json()).toEqual({ name: "agent-admin" });
    // Patching description alone preserves the existing files (merge over the current skill).
    expect(skills.get("agent-admin")).toEqual({
      name: "agent-admin",
      description: "Manage Gilly agents.",
      content: "# Agent Admin",
      files: [{ path: "run.ts", contents: "console.log('go')" }],
    });
  });
});

test("invoke echo.ping returns result and writes a tool_calls row", async () => {
  const { db, fetch, token } = setup(["echo.*"]);
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "echo.ping",
    input: { message: "hi" },
  });
  expect(await res.json()).toEqual({ echoed: "hi" });
  const rows = db.select().from(schema.toolCalls).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("ok");
  expect(rows[0]?.tool).toBe("echo.ping");
});

test("invoke caps a large result by default, but the script lane opts out", async () => {
  const { fetch, token } = setup(["echo.*"]);
  const big = "x".repeat(60_000); // echo.ping returns { echoed }, so the result exceeds 50KB
  // Direct lane (no header) → refused with a script-lane pointer, not the payload.
  const capped = await post(fetch, "/invoke", auth(token), {
    tool: "echo.ping",
    input: { message: big },
  });
  expect(await capped.json()).toEqual({
    error: "result_too_large",
    message: "result too large for the direct lane; use the script lane",
  });
  // Script lane (x-gilly-lane: script) → full payload through.
  const full = await post(
    fetch,
    "/invoke",
    { ...auth(token), "x-gilly-lane": "script" },
    { tool: "echo.ping", input: { message: big } },
  );
  expect(await full.json()).toEqual({ echoed: big });
});

test("catalog shows an agent-connected tool without a user grant", async () => {
  const { fetch, token } = setup([], { connectors: ["echo"] });
  const res = await post(fetch, "/catalog", auth(token), {});
  const body = (await res.json()) as { tools: { name: string }[] };
  expect(body.tools.map((tool) => tool.name)).toContain("echo.ping");
});

test("invoke connected but ungranted tool → user_missing_grant instructions", async () => {
  const { fetch, token } = setup([], { connectors: ["echo"] });
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "echo.ping",
    input: { message: "hi" },
  });
  expect(await res.json()).toEqual({
    error: "user_missing_grant",
    tool: "echo.ping",
    message:
      "Stop whatever you are doing and first inform the user that they do not have access to this tool. Wait for the user to respond before continuing, and do not retry this tool unless access is granted.",
  });
});

test("invoke tool outside the agent's connectors → forbidden", async () => {
  const { fetch, token } = setup(["github.*"], { connectors: ["echo"] });
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "github.create_issue",
    input: {},
  });
  expect(await res.json()).toEqual({ error: "forbidden" });
});

test("invoke invalid input → invalid_input", async () => {
  const { fetch, token } = setup(["echo.*"]);
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "echo.ping",
    input: { message: 5 },
  });
  expect(await res.json()).toEqual({ error: "invalid_input" });
});

test("expired token → 401", async () => {
  const { fetch, token } = setup(["echo.*"], { ttlMs: -1 });
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "echo.ping",
    input: { message: "x" },
  });
  expect(res.status).toBe(401);
});

test("missing token → 401", async () => {
  const { fetch } = setup(["echo.*"]);
  const res = await post(fetch, "/catalog", { "content-type": "application/json" }, {});
  expect(res.status).toBe(401);
});

test("admin credentials: no header → 401; with header → stores encrypted", async () => {
  const { db, fetch } = setup([]);
  const url = "http://x/admin/credentials/github";
  const unauth = await fetch(
    new Request(url, {
      method: "PUT",
      body: JSON.stringify({ key: "github_pat", value: "SECRET" }),
    }),
  );
  expect(unauth.status).toBe(401);

  const ok = await fetch(
    new Request(url, {
      method: "PUT",
      headers: { "x-admin-token": ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ key: "github_pat", value: "SECRET" }),
    }),
  );
  expect(await ok.json()).toEqual({ ok: true });
  const stored = getCredential(db, "github");
  expect(stored[0]?.value).not.toBe("SECRET");
});

type Status = {
  name: string;
  kind: "api" | "mcp";
  auth: "none" | "api_key" | "oauth";
  connected: boolean;
  requiredCreds: string[];
  toolCount?: number;
};
const getStatus = async (fetch: ReturnType<typeof createGatewayServer>, name: string) => {
  const res = await fetch(new Request("http://x/connectors"));
  const { connectors } = (await res.json()) as { connectors: Status[] };
  return connectors.find((c) => c.name === name) as Status;
};

test("connectors status: echo is none + connected, no creds required", async () => {
  const { fetch } = setup([]);
  const echo = await getStatus(fetch, "echo");
  expect(echo.auth).toBe("none");
  expect(echo.connected).toBe(true);
  expect(echo.requiredCreds).toEqual([]);
  expect(echo.toolCount).toBe(1);
});

test("connectors status: github api_key connects only once its cred is stored", async () => {
  const { db, fetch, vault } = setup([]);
  let github = await getStatus(fetch, "github");
  expect(github.kind).toBe("mcp");
  expect(github.auth).toBe("api_key");
  expect(github.requiredCreds).toEqual(["github_pat"]);
  expect(github.connected).toBe(false);
  expect(github.toolCount).toBeUndefined(); // mcp → tool count omitted

  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  github = await getStatus(fetch, "github");
  expect(github.connected).toBe(true);
});

test("connectors status: jira oauth connects only once an oauth_tokens row exists", async () => {
  const { db, fetch, vault } = setup([]);
  let jira = await getStatus(fetch, "jira");
  expect(jira.auth).toBe("oauth");
  expect(jira.requiredCreds).toEqual([]);
  expect(jira.connected).toBe(false);

  setCredential(db, "jira", "oauth_tokens", vault.encrypt(JSON.stringify({ access_token: "t" })));
  jira = await getStatus(fetch, "jira");
  expect(jira.connected).toBe(true);
});

// --- MCP connector (github) — offline via injected fake ---

test("catalog lists connected mcp tools when credentials are present", async () => {
  const { db, fetch, token, vault } = setup(["github.*"], { mcp: fakeMcp() });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string }[] };
  expect(tools.map((t) => t.name)).toContain("github.create_issue");
});

test("catalog skips (does not hang on) an mcp upstream whose listTools stalls", async () => {
  const hangingMcp: McpGateway = {
    listTools: () => new Promise(() => {}), // never resolves — a stalled upstream
    async callTool() {
      return {};
    },
  };
  const { db, fetch, token, vault } = setup(["github.*"], {
    mcp: hangingMcp,
    catalogTimeoutMs: 20,
  });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string }[] };
  expect(tools.some((t) => t.name.startsWith("github."))).toBe(false); // skipped, not hung
});

test("invoke mcp tool returns provider result and writes a tool_calls row", async () => {
  const { db, fetch, token, vault } = setup(["github.*"], { mcp: fakeMcp() });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "github.create_issue",
    input: { title: "x" },
  });
  expect(await res.json()).toEqual({ ok: true });
  const rows = db.select().from(schema.toolCalls).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.status).toBe("ok");
  expect(rows[0]?.tool).toBe("github.create_issue");
});

test("no github credential → catalog skips github tools", async () => {
  const { fetch, token } = setup(["github.*"], { mcp: fakeMcp() });
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string }[] };
  expect(tools.map((t) => t.name)).not.toContain("github.create_issue");
});

test("no github credential → invoke mcp tool returns not_connected", async () => {
  const { fetch, token } = setup(["github.*"], { mcp: fakeMcp() });
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "github.create_issue",
    input: {},
  });
  expect(await res.json()).toEqual({ error: "not_connected" });
});

test("mcp callTool throwing → provider_error", async () => {
  const { db, fetch, token, vault } = setup(["github.*"], { mcp: fakeMcp({ throwOnCall: true }) });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "github.create_issue",
    input: {},
  });
  expect(await res.json()).toEqual({ error: "provider_error" });
});

// --- OAuth connector (jira) — offline via a fake mcp that reports "not connected" ---

/** A fake MCP whose list/call both throw NotConnectedError, as the real oauth branch does pre-auth. */
const notConnectedMcp: McpGateway = {
  async listTools() {
    throw new NotConnectedError("jira");
  },
  async callTool() {
    throw new NotConnectedError("jira");
  },
};

test("oauth connector not connected → catalog omits its tools", async () => {
  const { fetch, token } = setup(["jira.*"], { mcp: notConnectedMcp });
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string }[] };
  expect(tools.some((t) => t.name.startsWith("jira."))).toBe(false);
});

test("oauth connector not connected → invoke returns not_connected", async () => {
  const { fetch, token } = setup(["jira.*"], { mcp: notConnectedMcp });
  const res = await post(fetch, "/invoke", auth(token), { tool: "jira.getIssue", input: {} });
  expect(await res.json()).toEqual({ error: "not_connected" });
});

test("GET /oauth/jira/start without admin token → 401", async () => {
  const { fetch } = setup([]);
  const res = await fetch(new Request("http://x/oauth/jira/start"));
  expect(res.status).toBe(401);
});

test("GET /oauth/unknown/start → 404 (with admin token)", async () => {
  const { fetch } = setup([]);
  const res = await fetch(
    new Request("http://x/oauth/nope/start", { headers: { "x-admin-token": ADMIN } }),
  );
  expect(res.status).toBe(404);
});

test("GET /oauth/jira/callback with bad state → 400 (CSRF)", async () => {
  const { fetch } = setup([]);
  // No persisted oauth_state, so any state mismatches → rejected before any network.
  const res = await fetch(new Request("http://x/oauth/jira/callback?state=forged&code=abc"));
  expect(res.status).toBe(400);
});
