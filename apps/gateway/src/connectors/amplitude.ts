import { defineMcpConnector } from "@gilly/gateway-kit";

/** Amplitude's hosted MCP server (streamable HTTP, PAT bearer). Its analytics tools are discovered, not written. */
export const amplitude = defineMcpConnector({
  name: "amplitude",
  transport: { kind: "http", url: "https://mcp.amplitude.com/mcp" },
  auth: {
    kind: "api_key",
    creds: ["amplitude_pat"],
    inject: (c) => ({ Authorization: `Bearer PAT=${c.amplitude_pat}` }),
  },
});
