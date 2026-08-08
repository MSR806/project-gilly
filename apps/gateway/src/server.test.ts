import { expect, test } from "bun:test";
import { createDb, createGatewayToken, getCredential, schema, setCredential } from "@gilly/db";
import { ComposioNotConnectedError, type ComposioService } from "./composio.ts";
import { type McpGateway, McpToolError, NotConnectedError } from "./mcp.ts";
import { allTools } from "./registry.ts";
import { createGatewayServer } from "./server.ts";
import { makeVault } from "./vault.ts";

const ADMIN = "admin-secret";

/** Build a fresh in-memory gateway with a token carrying exact tools and grants. */
function setup(
  grants: string[],
  opts: {
    tools?: string[];
    ttlMs?: number;
    mcp?: McpGateway;
    composio?: ComposioService;
    catalogTimeoutMs?: number;
    managementToolsTtlMs?: number;
  } = {},
) {
  const db = createDb(":memory:");
  const vault = makeVault("k");
  const fetch = createGatewayServer({
    db,
    vault,
    adminToken: ADMIN,
    mcp: opts.mcp,
    composio: opts.composio,
    catalogTimeoutMs: opts.catalogTimeoutMs,
    managementToolsTtlMs: opts.managementToolsTtlMs,
  });
  const token = createGatewayToken(db, {
    runId: "run-1",
    userId: "user-1",
    agentId: "agent-1",
    tools:
      opts.tools ??
      grants.flatMap((grant) =>
        grant.endsWith(".*")
          ? [
              ...allTools()
                .map((tool) => tool.name)
                .filter((name) => name.startsWith(grant.slice(0, -1))),
              ...(grant === "github.*"
                ? ["github.create_issue"]
                : grant === "jira.*"
                  ? ["jira.getIssue"]
                  : []),
            ]
          : [grant],
      ),
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

function fakeComposio(
  opts: {
    configured?: boolean;
    connected?: boolean;
    notConnectedOnExecute?: boolean;
    providerErrorOnExecute?: boolean;
  } = {},
): ComposioService {
  const configured = opts.configured ?? true;
  return {
    configured: () => configured,
    async listTools() {
      return configured && (opts.connected ?? true)
        ? [
            {
              name: "gmail.send_email",
              description: "Send an email",
              inputSchema: { type: "object" },
              source: "composio",
              toolkit: "gmail",
              connected: true,
              upstreamSlug: "GMAIL_SEND_EMAIL",
            },
          ]
        : [];
    },
    async listToolkits() {
      return configured
        ? {
            configured: true,
            items: [
              {
                slug: "gmail",
                name: "Gmail",
                description: "Email tools",
                logo: "gmail.png",
                toolsCount: 10,
                connected: opts.connected ?? true,
                noAuth: false,
              },
            ],
            nextCursor: "next",
          }
        : { configured: false, items: [] };
    },
    async authorize() {
      return "https://connect.composio.dev/link/1";
    },
    async execute() {
      if (opts.notConnectedOnExecute) throw new ComposioNotConnectedError("Not connected");
      if (opts.providerErrorOnExecute) throw new Error("upstream failed");
      return { sent: true };
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

const getTools = (fetch: ReturnType<typeof createGatewayServer>) =>
  fetch(new Request("http://x/tools", { headers: { "x-admin-token": ADMIN } }));

type Agent = {
  id: string;
  name: string;
  harness: { id: string; config: { model: string; serviceTier?: string } };
  systemPrompt: string;
  tools?: string[];
  skills?: string[];
  gatewayTools?: string[];
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
    starts: { id: string; message: string; userId: string; adminToken: string | null }[];
    runs: Map<string, RunState>;
  }) => Promise<T>,
): Promise<T> {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.GILLY_CONTROL_PLANE_URL;
  const oldAdminToken = process.env.GILLY_ADMIN_TOKEN;
  const state = {
    agents: new Map<string, Agent>([
      [
        "coder",
        {
          id: "coder",
          name: "Coder",
          harness: { id: "claude", config: { model: "claude-sonnet-4-5" } },
          systemPrompt: "code",
        },
      ],
    ]),
    skills: new Map<string, Skill>([
      ["tooling", { name: "tooling", description: "Use gateway tools.", content: "# Tools" }],
    ]),
    starts: [] as { id: string; message: string; userId: string; adminToken: string | null }[],
    runs: new Map<string, RunState>(),
  };
  process.env.GILLY_CONTROL_PLANE_URL = "http://control-plane.test";
  process.env.GILLY_ADMIN_TOKEN = ADMIN;
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
      state.starts.push({
        id: startAgentId,
        message: body.message,
        userId: body.userId,
        adminToken: new Headers(init?.headers).get("x-admin-token"),
      });
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
    if (url.pathname === "/api/harnesses" && method === "GET") {
      return json([
        {
          id: "claude",
          name: "Claude",
          image: "/harnesses/claude.svg",
          enabled: true,
          models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
        },
      ]);
    }
    if (url.pathname === "/api/agents" && method === "GET") {
      return json(
        [...state.agents.values()].map(({ id, name, harness }) => ({ id, name, harness })),
      );
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
    if (oldAdminToken === undefined) delete process.env.GILLY_ADMIN_TOKEN;
    else process.env.GILLY_ADMIN_TOKEN = oldAdminToken;
  }
}

test("catalog returns exact agent gateway tools only", async () => {
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
  expect(tools.map((t) => t.name)).toContain("gilly.list_harnesses");
  expect(tools.map((t) => t.name)).toContain("gilly.start_agent");
  expect(tools.map((t) => t.name)).toContain("gilly.get_run");
  expect(tools.map((t) => t.name)).not.toContain("gilly.invoke_agent");
  expect(tools.map((t) => t.name)).toContain("gilly.update_skill");
});

test("gilly.update_agent patches through the control-plane API", async () => {
  await withControlPlane(async ({ agents }) => {
    const { fetch, token } = setup(["gilly.*"]);
    const harnesses = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.list_harnesses",
      input: {},
    });
    expect(await harnesses.json()).toEqual([
      {
        id: "claude",
        name: "Claude",
        image: "/harnesses/claude.svg",
        enabled: true,
        models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
      },
    ]);
    const create = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.create_agent",
      input: {
        id: "helper",
        name: "Helper",
        harness: { id: "claude", config: { model: "claude-sonnet-4-5" } },
        systemPrompt: "Help.",
        gatewayTools: ["gilly.list_agents"],
      },
    });
    expect(await create.json()).toEqual({
      id: "helper",
      name: "Helper",
      harness: { id: "claude", config: { model: "claude-sonnet-4-5" } },
      systemPrompt: "Help.",
      gatewayTools: ["gilly.list_agents"],
    });
    expect(agents.get("helper")?.gatewayTools).toEqual(["gilly.list_agents"]);

    const res = await post(fetch, "/invoke", auth(token), {
      tool: "gilly.update_agent",
      input: {
        id: "coder",
        patch: { name: "Coder 2", gatewayTools: ["gilly.list_agents"] },
      },
    });
    expect(await res.json()).toEqual({
      id: "coder",
      name: "Coder 2",
      harness: { id: "claude", config: { model: "claude-sonnet-4-5" } },
      systemPrompt: "code",
      gatewayTools: ["gilly.list_agents"],
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
    expect(starts).toEqual([
      { id: "coder", message: "inspect this", userId: "user-1", adminToken: ADMIN },
    ]);

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
  const { fetch, token } = setup([], { tools: ["echo.ping"] });
  const res = await post(fetch, "/catalog", auth(token), {});
  const body = (await res.json()) as { tools: { name: string }[] };
  expect(body.tools.map((tool) => tool.name)).toContain("echo.ping");
});

test("invoke connected but ungranted tool → user_missing_grant instructions", async () => {
  const { fetch, token } = setup([], { tools: ["echo.ping"] });
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

test("invoke tool outside the agent's exact tools → forbidden", async () => {
  const { fetch, token } = setup(["github.*"], { tools: ["echo.ping"] });
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

test("GET /tools unifies custom, connected MCP, and Composio metadata", async () => {
  const { db, fetch, vault } = setup([], { mcp: fakeMcp(), composio: fakeComposio() });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));

  expect((await fetch(new Request("http://x/tools"))).status).toBe(401);
  const res = await getTools(fetch);
  const body = (await res.json()) as { tools: { name: string; source: string; toolkit: string }[] };
  expect(body.tools).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "echo.ping", source: "custom", toolkit: "echo" }),
      expect.objectContaining({
        name: "github.create_issue",
        source: "custom",
        toolkit: "github",
      }),
      expect.objectContaining({
        name: "gmail.send_email",
        source: "composio",
        toolkit: "gmail",
      }),
    ]),
  );
});

test("a failing Composio configuration check does not hide custom tools", async () => {
  const composio = fakeComposio();
  composio.configured = () => {
    throw new Error("decrypt failed");
  };
  const { fetch } = setup([], { composio });

  const response = await getTools(fetch);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tools: { name: string }[] };
  expect(body.tools.some((tool) => tool.name === "echo.ping")).toBe(true);
  expect(body.tools.some((tool) => tool.name === "gmail.send_email")).toBe(false);
});

test("management discovery shares in-flight work, caches briefly, and invalidates on credentials", async () => {
  let githubLists = 0;
  const mcp = fakeMcp();
  const listTools = mcp.listTools;
  mcp.listTools = async (connector, creds) => {
    if (connector.name === "github") githubLists += 1;
    return listTools(connector, creds);
  };
  const { db, fetch, vault } = setup([], {
    mcp,
    composio: fakeComposio(),
    managementToolsTtlMs: 100,
  });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));

  await Promise.all([getTools(fetch), getTools(fetch)]);
  await getTools(fetch);
  expect(githubLists).toBe(1);

  await Bun.sleep(110);
  await getTools(fetch);
  expect(githubLists).toBe(2);

  await fetch(
    new Request("http://x/admin/credentials/github", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ key: "github_pat", value: "new-pat" }),
    }),
  );
  await getTools(fetch);
  expect(githubLists).toBe(3);
});

test("dynamic invocation uses its exact discovery across cache invalidation", async () => {
  let discoveries = 0;
  let calls = 0;
  let release = () => {};
  let markStarted = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const mcp: McpGateway = {
    async listTools(connector) {
      if (connector.name !== "github") return [];
      discoveries += 1;
      if (discoveries === 1) {
        markStarted();
        await gate;
        return [{ name: "github.create_issue", description: "Create issue" }];
      }
      return [];
    },
    async callTool() {
      calls += 1;
      return { ok: true };
    },
  };
  const { db, fetch, token, vault } = setup(["github.*"], {
    tools: ["github.create_issue"],
    mcp,
    composio: fakeComposio({ configured: false }),
  });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));

  const invocation = post(fetch, "/invoke", auth(token), {
    tool: "github.create_issue",
    input: {},
  });
  await started;
  await fetch(
    new Request("http://x/admin/credentials/github", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ key: "github_pat", value: "new-pat" }),
    }),
  );
  release();

  expect(await (await invocation).json()).toEqual({ ok: true });
  expect(calls).toBe(1);
  const refreshed = (await (await getTools(fetch)).json()) as { tools: { name: string }[] };
  expect(refreshed.tools.some((tool) => tool.name === "github.create_issue")).toBe(false);
});

test("Composio invocation preserves its discovered upstream slug across invalidation", async () => {
  let discoveries = 0;
  let release = () => {};
  let markStarted = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const executed: string[] = [];
  const composio: ComposioService = {
    configured: () => true,
    async listTools() {
      discoveries += 1;
      if (discoveries === 1) {
        markStarted();
        await gate;
      }
      return [
        {
          name: "gmail.send_email",
          description: "Send email",
          source: "composio",
          toolkit: "gmail",
          connected: true,
          upstreamSlug: discoveries === 1 ? "GMAIL_SEND_EMAIL_OLD" : "GMAIL_SEND_EMAIL_NEW",
        },
      ];
    },
    async listToolkits() {
      return { configured: true, items: [] };
    },
    async authorize() {
      return "https://connect.composio.dev/link/1";
    },
    async execute(upstreamSlug) {
      executed.push(upstreamSlug);
      return { ok: true };
    },
  };
  const { fetch, token } = setup(["gmail.send_email"], { composio });

  const invocation = post(fetch, "/invoke", auth(token), {
    tool: "gmail.send_email",
    input: {},
  });
  await started;
  await fetch(
    new Request("http://x/admin/credentials/composio", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ key: "api_key", value: "new-key" }),
    }),
  );
  release();

  expect(await (await invocation).json()).toEqual({ ok: true });
  expect(
    await (
      await post(fetch, "/invoke", auth(token), { tool: "gmail.send_email", input: {} })
    ).json(),
  ).toEqual({
    ok: true,
  });
  expect(executed).toEqual(["GMAIL_SEND_EMAIL_OLD", "GMAIL_SEND_EMAIL_NEW"]);
});

test("MCP providers discover concurrently with independent deadlines", async () => {
  const seen: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mcp: McpGateway = {
    async listTools(connector) {
      seen.push(connector.name);
      if (seen.includes("github") && seen.includes("jira")) release();
      await gate;
      return [{ name: `${connector.name}.tool`, description: connector.name }];
    },
    async callTool() {
      return {};
    },
  };
  const { db, fetch, vault } = setup([], {
    mcp,
    composio: fakeComposio({ configured: false }),
    catalogTimeoutMs: 30,
  });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));

  const res = await getTools(fetch);
  const body = (await res.json()) as { tools: { name: string }[] };
  expect(body.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["github.tool", "jira.tool"]),
  );
});

test("removed and unknown dynamic tools never dispatch", async () => {
  let available = true;
  let mcpCalls = 0;
  let composioCalls = 0;
  const mcp: McpGateway = {
    async listTools(connector) {
      return available && connector.name === "github"
        ? [{ name: "github.create_issue", description: "Create issue" }]
        : [];
    },
    async callTool() {
      mcpCalls += 1;
      return {};
    },
  };
  const composio = fakeComposio();
  composio.execute = async () => {
    composioCalls += 1;
    return {};
  };
  const { db, fetch, token, vault } = setup(["github.*", "gmail.*"], {
    tools: ["github.create_issue", "github.removed", "gmail.removed"],
    mcp,
    composio,
  });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  await getTools(fetch);
  available = false;
  await fetch(
    new Request("http://x/admin/credentials/github", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ key: "github_pat", value: "new-pat" }),
    }),
  );

  for (const tool of ["github.create_issue", "github.removed", "gmail.removed"]) {
    const res = await post(fetch, "/invoke", auth(token), { tool, input: {} });
    expect(await res.json()).toEqual({ error: "forbidden" });
  }
  expect(mcpCalls).toBe(0);
  expect(composioCalls).toBe(0);
});

test("Composio discovery and toolkit routes time out boundedly", async () => {
  const composio = fakeComposio();
  composio.listTools = () => new Promise(() => {});
  composio.listToolkits = () => new Promise(() => {});
  const { fetch, token } = setup(["gmail.*"], {
    tools: ["gmail.send_email"],
    mcp: { listTools: async () => [], callTool: async () => ({}) },
    composio,
    catalogTimeoutMs: 20,
  });

  const invoke = await post(fetch, "/invoke", auth(token), {
    tool: "gmail.send_email",
    input: {},
  });
  expect(await invoke.json()).toEqual({ error: "forbidden" });
  const tools = await getTools(fetch);
  expect(tools.status).toBe(200);
  const toolkits = await fetch(
    new Request("http://x/admin/composio/toolkits", {
      headers: { "x-admin-token": ADMIN },
    }),
  );
  expect(toolkits.status).toBe(502);
  expect(await toolkits.json()).toEqual({ configured: true, items: [], error: "provider_error" });
});

test("Composio catalog and invocation use canonical names", async () => {
  const { fetch, token } = setup(["gmail.*"], {
    tools: ["gmail.send_email"],
    composio: fakeComposio(),
  });
  const catalog = await post(fetch, "/catalog", auth(token), {});
  const body = (await catalog.json()) as { tools: { name: string }[] };
  expect(body.tools.map((tool) => tool.name)).toEqual(["gmail.send_email"]);

  const invoke = await post(fetch, "/invoke", auth(token), {
    tool: "gmail.send_email",
    input: { to: "user@example.com" },
  });
  expect(await invoke.json()).toEqual({ sent: true });
});

test("Composio missing connection maps to not_connected", async () => {
  const { fetch, token } = setup(["gmail.*"], {
    tools: ["gmail.send_email"],
    composio: fakeComposio({ notConnectedOnExecute: true }),
  });
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "gmail.send_email",
    input: {},
  });
  expect(await res.json()).toEqual({ error: "not_connected" });
});

test("unknown Composio provider failures map to provider_error", async () => {
  const { fetch, token } = setup(["gmail.*"], {
    tools: ["gmail.send_email"],
    composio: fakeComposio({ providerErrorOnExecute: true }),
  });
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "gmail.send_email",
    input: {},
  });
  expect(await res.json()).toEqual({ error: "provider_error" });
});

test("custom tools win canonical-name collisions with Composio", async () => {
  const composio = fakeComposio();
  composio.listTools = async () => [
    {
      name: "echo.ping",
      description: "Remote echo",
      source: "composio",
      toolkit: "echo",
      connected: true,
      upstreamSlug: "ECHO_PING",
    },
  ];
  const { fetch } = setup([], { composio });
  const res = await getTools(fetch);
  const body = (await res.json()) as { tools: { name: string; source: string }[] };
  expect(body.tools.filter((tool) => tool.name === "echo.ping")).toEqual([
    expect.objectContaining({ name: "echo.ping", source: "custom" }),
  ]);
});

test("Composio admin routes are gated and relay toolkit metadata and auth redirect", async () => {
  const { fetch } = setup([], { composio: fakeComposio() });
  const unauthorized = await fetch(new Request("http://x/admin/composio/toolkits"));
  expect(unauthorized.status).toBe(401);

  const list = await fetch(
    new Request("http://x/admin/composio/toolkits?query=mail&cursor=one", {
      headers: { "x-admin-token": ADMIN },
    }),
  );
  expect(await list.json()).toEqual({
    configured: true,
    items: [
      {
        slug: "gmail",
        name: "Gmail",
        description: "Email tools",
        logo: "gmail.png",
        toolsCount: 10,
        connected: true,
        noAuth: false,
      },
    ],
    nextCursor: "next",
  });

  const connect = await fetch(
    new Request("http://x/admin/composio/toolkits/gmail/connect", {
      headers: { "x-admin-token": ADMIN },
    }),
  );
  expect(connect.status).toBe(302);
  expect(connect.headers.get("location")).toBe("https://connect.composio.dev/link/1");
});

test("Composio toolkit route returns structured not configured response", async () => {
  const { fetch } = setup([], { composio: fakeComposio({ configured: false }) });
  const res = await fetch(
    new Request("http://x/admin/composio/toolkits", {
      headers: { "x-admin-token": ADMIN },
    }),
  );
  expect(await res.json()).toEqual({ configured: false, items: [] });
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

test("no github credential → invoke mcp tool fails closed", async () => {
  const { fetch, token } = setup(["github.*"], { mcp: fakeMcp() });
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "github.create_issue",
    input: {},
  });
  expect(await res.json()).toEqual({ error: "forbidden" });
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

test("mcp tool errors preserve normalized provider details", async () => {
  const mcp = fakeMcp();
  mcp.callTool = async () => {
    throw new McpToolError({ code: "invalid_definition", message: "Unknown event property" });
  };
  const { fetch, token, vault, db } = setup(["github.*"], { mcp });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  const res = await post(fetch, "/invoke", auth(token), {
    tool: "github.create_issue",
    input: {},
  });
  expect(await res.json()).toEqual({
    error: "provider_error",
    details: { code: "invalid_definition", message: "Unknown event property" },
  });
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

test("oauth connector not connected → invoke fails closed", async () => {
  const { fetch, token } = setup(["jira.*"], { mcp: notConnectedMcp });
  const res = await post(fetch, "/invoke", auth(token), { tool: "jira.getIssue", input: {} });
  expect(await res.json()).toEqual({ error: "forbidden" });
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
