import type { Connector, McpConnector, ToolDef } from "@gilly/gateway-kit";
import { connectors } from "./connectors/index.ts";

type Entry = { connector: Connector; tool: ToolDef };

const apiConnectors = connectors.filter((c): c is Connector => c.kind === "api");
const mcp = connectors.filter((c): c is McpConnector => c.kind === "mcp");

/** Flatten API connectors into a name → { connector, tool } map. Tool names are already dotted. */
const byName = new Map<string, Entry>(
  apiConnectors.flatMap((connector) =>
    connector.tools.map((tool) => [tool.name, { connector, tool }] as const),
  ),
);

export function allTools(): ToolDef[] {
  return [...byName.values()].map((e) => e.tool);
}

export function getTool(name: string): Entry | undefined {
  return byName.get(name);
}

/** The MCP connectors — tools are discovered at runtime, not indexed here. */
export function mcpConnectors(): McpConnector[] {
  return mcp;
}

/** Find the MCP connector owning a dotted tool name (`github.create_issue` → github). */
export function getMcpConnector(toolName: string): McpConnector | undefined {
  const ns = toolName.split(".")[0];
  return mcp.find((c) => c.name === ns);
}

/** Static (credential-free) connector metadata. `connected` is layered on in the server from the db. */
export type ConnectorMeta = {
  name: string;
  kind: "api" | "mcp";
  auth: "none" | "api_key" | "oauth";
  requiredCreds: string[];
  toolCount?: number;
};

/** Every connector's status shape minus `connected` — no secrets, safe to expose unauthenticated. */
export function connectorMeta(): ConnectorMeta[] {
  return [
    ...apiConnectors.map(
      (c): ConnectorMeta => ({
        name: c.name,
        kind: "api",
        auth: c.auth.kind === "oauth2" ? "oauth" : c.auth.kind,
        // api_key api connector → union of its tools' declared creds; none/oauth → [].
        requiredCreds:
          c.auth.kind === "api_key" ? [...new Set(c.tools.flatMap((t) => t.creds))] : [],
        toolCount: c.tools.length,
      }),
    ),
    ...mcp.map(
      (c): ConnectorMeta => ({
        name: c.name,
        kind: "mcp",
        auth: c.auth.kind,
        requiredCreds: c.auth.kind === "api_key" ? c.auth.creds : [],
        // toolCount omitted for mcp — tools are discovered, not indexed here.
      }),
    ),
  ];
}
