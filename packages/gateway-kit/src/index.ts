import type { z } from "zod";

/**
 * Per-invocation context the gateway hands a tool handler: the resolved caller, the credentials
 * the vault supplied for this tool's declared `creds`, and a trace hook the gateway wires to its
 * `tool_calls` audit log.
 */
export type ToolContext = {
  userId: string;
  creds: Record<string, string>;
  trace: (event: { tool: string; ok: boolean }) => void;
};

/** A single tool, authored with `defineTool`. `input` stays a `z.ZodType` so the gateway can `.safeParse`. */
export type ToolDef<I = unknown> = {
  name: string;
  description: string;
  input: z.ZodType<I>;
  /** Credential keys the vault must supply into `ctx.creds`. */
  creds: string[];
  handler: (input: I, ctx: ToolContext) => Promise<unknown>;
};

/**
 * Identity function that types a tool definition. The generic is erased on the way out so a
 * connector can hold a heterogeneous `ToolDef[]`.
 */
export function defineTool<I>(def: {
  name: string;
  description: string;
  input: z.ZodType<I>;
  creds?: string[];
  handler: (input: I, ctx: ToolContext) => Promise<unknown>;
}): ToolDef {
  return { ...def, creds: def.creds ?? [] } as ToolDef;
}

/** How a connector authenticates. Only "none" and "api_key" are used now. */
export type AuthConfig =
  | { kind: "none" }
  | { kind: "api_key" }
  // ponytail: oauth2 typed, implemented in step 5
  | { kind: "oauth2" };

/** A provider grouping: its auth kind plus the tools it exposes. `kind` discriminates it from MCP. */
export type Connector = {
  kind: "api";
  name: string;
  auth: AuthConfig;
  tools: ToolDef[];
};

/** Identity function that types a connector. */
export function defineConnector(connector: {
  name: string;
  auth: AuthConfig;
  tools: ToolDef[];
}): Connector {
  return { kind: "api", ...connector };
}

/** How the gateway reaches an MCP backend. */
export type McpTransport =
  | { kind: "http"; url: string }
  | {
      kind: "stdio";
      command: string[];
      env?: (creds: Record<string, string>) => Record<string, string>;
    };

/**
 * How an MCP connector authenticates. `creds` lists the vault keys required; `inject` turns the
 * resolved creds into headers (http) or is used to build env (stdio). `oauth` carries no creds/inject
 * — the gateway attaches an OAuthClientProvider that owns the token lifecycle (see apps/gateway/src/oauth.ts).
 */
export type McpAuth =
  | { kind: "none" }
  | {
      kind: "api_key";
      creds: string[];
      inject: (creds: Record<string, string>) => Record<string, string>;
    }
  | { kind: "oauth" };

/** A vendor-hosted or child-process MCP server. Its tools are discovered, not written. */
export type McpConnector = {
  kind: "mcp";
  name: string;
  transport: McpTransport;
  auth: McpAuth;
};

/** Identity function that types an MCP connector. */
export function defineMcpConnector(c: Omit<McpConnector, "kind">): McpConnector {
  return { kind: "mcp", ...c };
}

/** Either connector shape; the registry splits on `kind`. */
export type AnyConnector = Connector | McpConnector;
