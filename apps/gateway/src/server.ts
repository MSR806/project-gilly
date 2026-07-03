import { type Db, getCredential, getGatewayToken, insertToolCall, setCredential } from "@gilly/db";
import type { ToolContext } from "@gilly/gateway-kit";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { isAllowed } from "./access.ts";
import { type CatalogTool, type McpGateway, makeRealMcp, NotConnectedError } from "./mcp.ts";
import { clearOAuth, VaultOAuthProvider } from "./oauth.ts";
import { allTools, connectorMeta, getMcpConnector, getTool, mcpConnectors } from "./registry.ts";
import type { Vault } from "./vault.ts";

const TIMEOUT_MS = 30_000;
const RESULT_CAP = 50_000; // direct-lane result cap; larger results belong in the script lane

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Escape untrusted text (provider name, OAuth error param) before reflecting it into an HTML page. */
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function bearer(req: Request): string | undefined {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}

type Token = { userId: string; runId: string; grants: string[] };

/**
 * The gateway fetch handler as a factory (no port binding) so tests drive it directly.
 * Routes: POST /catalog, POST /invoke, GET /connectors, PUT /admin/credentials/:provider.
 */
export function createGatewayServer(deps: {
  db: Db;
  vault: Vault;
  adminToken: string;
  /** Base URL the gateway is reachable at; used to build OAuth redirect URIs. */
  gatewayUrl?: string;
  /** Web app base URL to bounce back to after an OAuth connect (so the same tab returns to the UI). */
  webUrl?: string;
  mcp?: McpGateway;
}) {
  const { db, vault, adminToken } = deps;
  const gatewayUrl = deps.gatewayUrl ?? "http://localhost:4100";
  const webUrl = deps.webUrl ?? "http://localhost:3000";
  const mcp = deps.mcp ?? makeRealMcp({ db, vault, gatewayUrl });

  /** Resolve the bearer token, rejecting missing/expired with a 401 Response. */
  function auth(req: Request): { token: Token } | { error: Response } {
    const raw = bearer(req);
    if (!raw) return { error: json({ error: "unauthorized" }, 401) };
    const row = getGatewayToken(db, raw);
    if (!row || row.expiresAt < Date.now()) return { error: json({ error: "unauthorized" }, 401) };
    return { token: { userId: row.userId, runId: row.runId, grants: row.grants } };
  }

  /** Decrypt the given keys for a provider; null if any required key is missing from the vault. */
  function resolveCreds(
    connectorName: string,
    requiredKeys: string[],
  ): Record<string, string> | null {
    const stored = new Map(getCredential(db, connectorName).map((c) => [c.key, c.value]));
    const creds: Record<string, string> = {};
    for (const key of requiredKeys) {
      const enc = stored.get(key);
      if (!enc) return null;
      creds[key] = vault.decrypt(enc);
    }
    return creds;
  }

  /**
   * Connector status for the admin UI — static metadata + a `connected` flag derived purely from the
   * db (no network). none → always; api_key → all required creds stored; oauth → an oauth_tokens row.
   */
  function connectors() {
    return connectorMeta().map((c) => {
      const keys = new Set(getCredential(db, c.name).map((r) => r.key));
      const connected =
        c.auth === "none"
          ? true
          : c.auth === "oauth"
            ? keys.has("oauth_tokens")
            : c.requiredCreds.every((k) => keys.has(k));
      return { ...c, connected };
    });
  }

  async function catalog(req: Request): Promise<Response> {
    const a = auth(req);
    if ("error" in a) return a.error;
    const body = ((await readJson(req)) ?? {}) as { query?: string };
    const q = body.query?.toLowerCase();

    // Static API tools (local zod schema → JSON schema).
    const apiEntries = allTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.input),
    }));

    // Discovered MCP tools. A connector that is unconfigured (no creds) or down (listTools throws)
    // is skipped — the catalog must never 500 because one provider is unavailable.
    const mcpEntries: CatalogTool[] = [];
    for (const connector of mcpConnectors()) {
      const creds = resolveCreds(
        connector.name,
        connector.auth.kind === "api_key" ? connector.auth.creds : [],
      );
      if (!creds) continue;
      try {
        for (const t of await mcp.listTools(connector, creds)) mcpEntries.push(t);
      } catch (err) {
        // not_connected is expected (unconfigured OAuth connector) — skip quietly; log real failures.
        if (!(err instanceof NotConnectedError))
          console.warn(`[gateway] listTools failed for ${connector.name}:`, err);
      }
    }

    const tools = [...apiEntries, ...mcpEntries].filter(
      (t) =>
        isAllowed(t.name, a.token.grants) &&
        (!q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
    );
    return json({ tools });
  }

  async function invoke(req: Request): Promise<Response> {
    const a = auth(req);
    if ("error" in a) return a.error;
    const { userId, runId, grants } = a.token;
    const body = ((await readJson(req)) ?? {}) as { tool?: string; input?: unknown };
    const toolName = body.tool ?? "";

    const started = Date.now();
    const trace = () => {}; // status is derived from the result below; tracing is by construction

    const result = await run();
    // A result carrying `error` is a failure; a raw result is success.
    const status = result && typeof result === "object" && "error" in result ? "error" : "ok";
    insertToolCall(db, {
      runId,
      userId,
      tool: toolName,
      args: body.input,
      durationMs: Date.now() - started,
      status,
    });
    return json(result);

    async function run(): Promise<unknown> {
      // Unknown or ungranted tools are indistinguishable to the caller: forbidden.
      if (!isAllowed(toolName, grants)) return { error: "forbidden" };

      const entry = getTool(toolName);
      if (entry) {
        // API tool: resolve declared creds, validate input locally, run the handler.
        const { connector, tool } = entry;
        const creds = resolveCreds(
          connector.name,
          connector.auth.kind === "none" ? [] : tool.creds,
        );
        if (!creds) return { error: "not_connected" };

        const parsed = tool.input.safeParse(body.input);
        if (!parsed.success) return { error: "invalid_input" };

        const ctx: ToolContext = { userId, creds, trace };
        return capped(() => tool.handler(parsed.data, ctx));
      }

      // MCP tool: no local schema (the upstream server validates); resolve api_key creds, dispatch.
      const connector = getMcpConnector(toolName);
      if (!connector) return { error: "forbidden" };
      const creds = resolveCreds(
        connector.name,
        connector.auth.kind === "api_key" ? connector.auth.creds : [],
      );
      if (!creds) return { error: "not_connected" };
      const upstreamName = toolName.slice(connector.name.length + 1);
      return capped(() => mcp.callTool(connector, creds, upstreamName, body.input));
    }

    /** Shared timeout + result-size cap; a thrown handler maps to provider_error. */
    async function capped(exec: () => Promise<unknown>): Promise<unknown> {
      const timeout = Symbol("timeout");
      let result: unknown;
      try {
        result = await Promise.race([
          exec(),
          new Promise((resolve) => setTimeout(() => resolve(timeout), TIMEOUT_MS)),
        ]);
      } catch (err) {
        // An OAuth connector with no/invalid tokens is not_connected, not a provider fault.
        if (err instanceof NotConnectedError) return { error: "not_connected" };
        return { error: "provider_error" };
      }
      if (result === timeout) return { error: "timeout" };
      if (JSON.stringify(result).length > RESULT_CAP) {
        return {
          error: "provider_error",
          message: "result exceeds direct-lane cap; use the script lane",
        };
      }
      return result;
    }
  }

  function credentialsRoute(req: Request, provider: string): Promise<Response> | Response {
    if (req.headers.get("x-admin-token") !== adminToken)
      return json({ error: "unauthorized" }, 401);
    return (async () => {
      const body = ((await readJson(req)) ?? {}) as { key?: string; value?: string };
      if (!body.key || typeof body.value !== "string") {
        return json({ error: "key and value are required" }, 400);
      }
      setCredential(db, provider, body.key, vault.encrypt(body.value));
      return json({ ok: true });
    })();
  }

  /** The oauth MCP connector for `provider`, or undefined if unknown / not oauth / not http. */
  function oauthConnector(provider: string) {
    const c = mcpConnectors().find((c) => c.name === provider);
    if (!c) return undefined;
    if (c.auth.kind !== "oauth" || c.transport.kind !== "http") return undefined;
    return c as typeof c & { transport: { kind: "http"; url: string } };
  }

  const htmlPage = (msg: string, status = 200) =>
    new Response(`<!doctype html><meta charset="utf-8"><p>${escapeHtml(msg)}</p>`, {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  /**
   * GET /oauth/:provider/start — admin-gated. Kick off the auth-code flow: connecting with an empty
   * token store makes the SDK run discovery + (lazy) DCR, then call the provider's
   * `redirectToAuthorization` and throw UnauthorizedError. We then 302 the admin's browser to the
   * captured consent URL. All flow state (verifier/state/discovery) is persisted to the DB in-flight.
   */
  async function oauthStart(req: Request, provider: string): Promise<Response> {
    if (req.headers.get("x-admin-token") !== adminToken)
      return json({ error: "unauthorized" }, 401);
    const connector = oauthConnector(provider);
    if (!connector) return json({ error: "not found" }, 404);

    const authProvider = new VaultOAuthProvider(db, vault, provider, gatewayUrl);
    const client = new Client({ name: "gilly-gateway", version: "0.0.0" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(connector.transport.url), { authProvider }),
      );
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
    }
    const url = authProvider.authorizationUrl;
    // connect() succeeded without a redirect ⇒ already authorized (tokens present).
    if (!url) return json({ ok: true, message: `${provider} already connected` });
    return new Response(null, { status: 302, headers: { Location: url.toString() } });
  }

  /**
   * GET /oauth/:provider/callback — NOT admin-gated (Atlassian redirects the browser here, we can't
   * set a header). CSRF is the trust boundary: the `state` query param must equal the value we
   * persisted in /start. Then exchange the code for tokens on a fresh transport and clear transient rows.
   */
  async function oauthCallback(req: Request, provider: string): Promise<Response> {
    const connector = oauthConnector(provider);
    if (!connector) return json({ error: "not found" }, 404);

    const params = new URL(req.url).searchParams;
    const err = params.get("error");
    if (err) return htmlPage(`Authorization failed: ${err}`, 400);

    const authProvider = new VaultOAuthProvider(db, vault, provider, gatewayUrl);
    // CSRF check — do not skip. Mismatched/absent state means this callback isn't ours.
    const expected = authProvider.lastState;
    const returned = params.get("state");
    if (!expected || !returned || returned !== expected)
      return htmlPage("Invalid OAuth state (possible CSRF).", 400);

    const code = params.get("code");
    if (!code) return htmlPage("Missing authorization code.", 400);

    try {
      // finishAuth(authorizationCode: string) in @modelcontextprotocol/sdk@1.29.0 — pass the code.
      const transport = new StreamableHTTPClientTransport(new URL(connector.transport.url), {
        authProvider,
      });
      await transport.finishAuth(code);
    } catch (e) {
      return htmlPage(`Authorization failed: ${(e as Error).message}`, 400);
    }
    clearOAuth(db, provider); // tokens + client info remain; verifier/state/discovery are done.
    // Bounce back to the web app's Connectors page in the same tab (the Connect button navigated here).
    const back = `${webUrl}/connectors?connected=${encodeURIComponent(provider)}`;
    return new Response(null, { status: 302, headers: { Location: back } });
  }

  return function fetch(req: Request): Response | Promise<Response> {
    const { pathname } = new URL(req.url);
    const { method } = req;

    if (method === "POST" && pathname === "/catalog") return catalog(req);
    if (method === "POST" && pathname === "/invoke") return invoke(req);
    if (method === "GET" && pathname === "/connectors") return json({ connectors: connectors() });

    const oauthMatch = /^\/oauth\/([^/]+)\/(start|callback)$/.exec(pathname);
    if (method === "GET" && oauthMatch) {
      const provider = decodeURIComponent(oauthMatch[1] as string);
      return oauthMatch[2] === "start" ? oauthStart(req, provider) : oauthCallback(req, provider);
    }

    const provider = pathname.startsWith("/admin/credentials/")
      ? pathname.slice("/admin/credentials/".length)
      : undefined;
    if (method === "PUT" && provider) return credentialsRoute(req, decodeURIComponent(provider));

    return json({ error: "not found" }, 404);
  };
}
