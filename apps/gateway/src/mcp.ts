import type { Db } from "@gilly/db";
import type { McpConnector } from "@gilly/gateway-kit";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VaultOAuthProvider } from "./oauth.ts";
import type { Vault } from "./vault.ts";

/** A catalog entry as the gateway exposes it: names are already namespaced (`github.create_issue`). */
export type CatalogTool = { name: string; description: string; inputSchema?: unknown };

/**
 * Thrown when an OAuth-backed connector has no usable tokens (never authorized, or the refresh was
 * rejected). Distinguishable so the server maps it to `not_connected` rather than `provider_error` —
 * there is no browser in an invoke, so we can't run the consent redirect here.
 */
export class NotConnectedError extends Error {
  constructor(connector: string) {
    super(`connector "${connector}" is not connected (no OAuth tokens)`);
    this.name = "NotConnectedError";
  }
}

/**
 * The gateway's view of an MCP backend. An interface so the server/registry can be driven offline
 * with a fake — the real impl below is the only thing that touches the network / spawns processes.
 */
export interface McpGateway {
  listTools(connector: McpConnector, creds: Record<string, string>): Promise<CatalogTool[]>;
  callTool(
    connector: McpConnector,
    creds: Record<string, string>,
    upstreamName: string,
    args: unknown,
  ): Promise<unknown>;
}

// ponytail: tool discovery is cached in-process only — one connected Client per connector, no DB
// cache. The vendor-down-resilience DB cache from connectors-and-auth.md is a later add.
export function makeRealMcp(deps: { db: Db; vault: Vault; gatewayUrl: string }): McpGateway {
  const { db, vault, gatewayUrl } = deps;
  const clients = new Map<string, Client>();

  async function clientFor(
    connector: McpConnector,
    creds: Record<string, string>,
  ): Promise<Client> {
    const cached = clients.get(connector.name);
    if (cached) return cached;

    const client = new Client({ name: "gilly-gateway", version: "0.0.0" });
    const { transport, auth } = connector;
    if (transport.kind === "http") {
      if (auth.kind === "oauth") {
        const authProvider = new VaultOAuthProvider(db, vault, connector.name, gatewayUrl);
        // No tokens yet → not connected. Don't touch the network; the consent redirect lives in
        // GET /oauth/:provider/start, and there is no browser here to complete it.
        if (!authProvider.tokens()) throw new NotConnectedError(connector.name);
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(transport.url), { authProvider }),
          );
        } catch (err) {
          // Tokens present but rejected (revoked / refresh failed): the SDK surfaces UnauthorizedError.
          if (err instanceof UnauthorizedError) throw new NotConnectedError(connector.name);
          throw err;
        }
      } else {
        const headers = auth.kind === "api_key" ? auth.inject(creds) : {};
        await client.connect(
          new StreamableHTTPClientTransport(new URL(transport.url), {
            requestInit: { headers },
          }),
        );
      }
    } else {
      // The SDK wants Record<string,string>; drop undefined process-env values.
      const baseEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) baseEnv[k] = v;
      const [command, ...args] = transport.command;
      await client.connect(
        new StdioClientTransport({
          command: command ?? "",
          args,
          env: { ...baseEnv, ...(transport.env?.(creds) ?? {}) },
        }),
      );
    }
    clients.set(connector.name, client);
    return client;
  }

  /** Any failure invalidates the cached client so the next call reconnects. */
  function drop(name: string) {
    clients.delete(name);
  }

  return {
    async listTools(connector, creds) {
      try {
        const client = await clientFor(connector, creds);
        const { tools } = await client.listTools();
        return tools.map((t) => ({
          name: `${connector.name}.${t.name}`,
          description: t.description ?? "",
          inputSchema: t.inputSchema,
        }));
      } catch (err) {
        drop(connector.name);
        throw err;
      }
    },
    async callTool(connector, creds, upstreamName, args) {
      try {
        const client = await clientFor(connector, creds);
        const res = await client.callTool({
          name: upstreamName,
          arguments: (args as Record<string, unknown>) ?? {},
        });
        if (res.isError) throw new Error("mcp tool returned isError");
        return res.content;
      } catch (err) {
        drop(connector.name);
        throw err;
      }
    },
  };
}
