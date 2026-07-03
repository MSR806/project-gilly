import { expect, test } from "bun:test";
import { z } from "zod";
import { defineConnector, defineMcpConnector, defineTool } from "./index.ts";

test("defineTool preserves fields and defaults creds to []", () => {
  const tool = defineTool({
    name: "branch.query",
    description: "Query Branch installs",
    input: z.object({ app: z.string() }),
    handler: async (input) => input,
  });
  expect(tool.name).toBe("branch.query");
  expect(tool.description).toBe("Query Branch installs");
  expect(tool.creds).toEqual([]);
});

test("defineConnector collects tools", () => {
  const a = defineTool({ name: "a", description: "", input: z.unknown(), handler: async () => 1 });
  const b = defineTool({ name: "b", description: "", input: z.unknown(), handler: async () => 2 });
  const connector = defineConnector({ name: "branch", auth: { kind: "api_key" }, tools: [a, b] });
  expect(connector.kind).toBe("api");
  expect(connector.tools.map((t) => t.name)).toEqual(["a", "b"]);
  expect(connector.auth.kind).toBe("api_key");
});

test("defineMcpConnector supports oauth auth (no creds/inject)", () => {
  const c = defineMcpConnector({
    name: "jira",
    transport: { kind: "http", url: "https://mcp.atlassian.com/v1/mcp" },
    auth: { kind: "oauth" },
  });
  expect(c.kind).toBe("mcp");
  expect(c.auth).toEqual({ kind: "oauth" });
});

test("defineMcpConnector tags kind:mcp and injects auth headers", () => {
  const c = defineMcpConnector({
    name: "github",
    transport: { kind: "http", url: "https://api.githubcopilot.com/mcp/" },
    auth: {
      kind: "api_key",
      creds: ["github_pat"],
      inject: (creds) => ({ Authorization: `Bearer ${creds.github_pat}` }),
    },
  });
  expect(c.kind).toBe("mcp");
  expect(c.transport).toEqual({ kind: "http", url: "https://api.githubcopilot.com/mcp/" });
  expect(c.auth.kind === "api_key" && c.auth.inject({ github_pat: "x" })).toEqual({
    Authorization: "Bearer x",
  });
});
