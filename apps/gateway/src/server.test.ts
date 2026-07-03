import { expect, test } from "bun:test";
import { createDb, createGatewayToken, getCredential, schema, setCredential } from "@gilly/db";
import { type McpGateway, NotConnectedError } from "./mcp.ts";
import { createGatewayServer } from "./server.ts";
import { makeVault } from "./vault.ts";

const ADMIN = "admin-secret";

/** Build a fresh in-memory gateway with a token carrying `grants`; returns the fetch handler + token. */
function setup(grants: string[], opts: { ttlMs?: number; mcp?: McpGateway } = {}) {
  const db = createDb(":memory:");
  const vault = makeVault("k");
  const fetch = createGatewayServer({ db, vault, adminToken: ADMIN, mcp: opts.mcp });
  const token = createGatewayToken(db, {
    runId: "run-1",
    userId: "user-1",
    agentId: "agent-1",
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

test("catalog returns granted tools only", async () => {
  const { fetch, token } = setup(["echo.*"]);
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string; inputSchema: unknown }[] };
  const names = tools.map((t) => t.name);
  expect(names).toContain("echo.ping");
  expect(names).not.toContain("github.create_issue");
  expect(tools[0]?.inputSchema).toBeDefined();
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

test("invoke ungranted tool → forbidden", async () => {
  const { fetch, token } = setup(["echo.*"]);
  const res = await post(fetch, "/invoke", auth(token), { tool: "github.create_issue", input: {} });
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

test("catalog lists mcp tools when creds present and granted", async () => {
  const { db, fetch, token, vault } = setup(["github.*"], { mcp: fakeMcp() });
  setCredential(db, "github", "github_pat", vault.encrypt("pat"));
  const res = await post(fetch, "/catalog", auth(token), {});
  const { tools } = (await res.json()) as { tools: { name: string }[] };
  expect(tools.map((t) => t.name)).toContain("github.create_issue");
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
