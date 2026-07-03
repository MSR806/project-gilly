import { defineMcpConnector } from "@gilly/gateway-kit";

/** GitHub's hosted MCP server, reached over Streamable HTTP with a PAT bearer token. */
export const github = defineMcpConnector({
  name: "github",
  transport: { kind: "http", url: "https://api.githubcopilot.com/mcp/" },
  auth: {
    kind: "api_key",
    creds: ["github_pat"],
    inject: (c) => ({ Authorization: `Bearer ${c.github_pat}` }),
  },
});
