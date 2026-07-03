import { defineMcpConnector } from "@gilly/gateway-kit";

/**
 * Atlassian's hosted MCP server, reached over Streamable HTTP with OAuth 2.1 (auth-code + PKCE,
 * Dynamic Client Registration). Connect it via `GET /oauth/jira/start`.
 * ponytail: this server also surfaces Confluence tools — namespacing them all under `jira.*` is fine for now.
 */
export const jira = defineMcpConnector({
  name: "jira",
  transport: { kind: "http", url: "https://mcp.atlassian.com/v1/mcp" },
  auth: { kind: "oauth" },
});
