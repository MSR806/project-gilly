import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { InvocationRequest } from "@gilly/harness-protocol";
import {
  buildOptions,
  expandTools,
  gatewayMcpResult,
  gatewayPost,
  makeGatewayMcpServer,
  materializeSkills,
  reduceSdkStream,
  runAgentLoop,
  streamAgentLoop,
  summarizeToolUse,
  workspaceDir,
} from "./loop.ts";

test("expandTools maps Gilly abstractions to SDK tools and de-dupes; unknowns pass through", () => {
  expect(expandTools(["Read", "Write", "Bash"])).toEqual([
    "Read",
    "Glob",
    "Grep",
    "Write",
    "Edit",
    "Bash",
  ]);
  expect(expandTools([])).toEqual([]);
  expect(expandTools(["Read", "Grep"])).toEqual(["Read", "Glob", "Grep"]); // dedupe
  expect(expandTools(["Custom"])).toEqual(["Custom"]); // unknown passes through
});

// Minimal message factories; cast since we only populate the fields the reducer reads.
const msg = (o: unknown) => o as SDKMessage;
const init = (id: string) => msg({ type: "system", subtype: "init", session_id: id });
const assistant = (text: string) =>
  msg({ type: "assistant", message: { content: [{ type: "text", text }] } });
const result = (text: string) => msg({ type: "result", subtype: "success", result: text });
const toolUse = (name: string, input: unknown) =>
  msg({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const narrateThenTool = (text: string, name: string, input: unknown) =>
  msg({
    type: "assistant",
    message: {
      content: [
        { type: "text", text },
        { type: "tool_use", name, input },
      ],
    },
  });

async function* stream(...msgs: SDKMessage[]) {
  yield* msgs;
}

const req: InvocationRequest = {
  agent: { id: "a", name: "A", model: "claude-sonnet-4-5", systemPrompt: "do x" },
  userMessage: "hi",
};

test("reduceSdkStream captures session id and prefers the result text", async () => {
  const out = await reduceSdkStream(stream(init("s1"), assistant("partial"), result("final")));
  expect(out).toEqual({ harnessSessionId: "s1", finalText: "final" });
});

test("reduceSdkStream falls back to assistant text when no result message", async () => {
  const out = await reduceSdkStream(stream(init("s1"), assistant("a"), assistant("b")));
  expect(out).toEqual({ harnessSessionId: "s1", finalText: "ab" });
});

test("runAgentLoop returns a completed result via an injected query", async () => {
  const queryFn = (() => stream(init("s2"), result("done"))) as unknown as typeof query;
  const out = await runAgentLoop(req, queryFn);
  expect(out).toEqual({
    status: "completed",
    finalText: "done",
    harnessSessionId: "s2",
    error: null,
  });
});

test("runAgentLoop never throws — failures become an error result", async () => {
  const queryFn = (() => {
    throw new Error("boom");
  }) as unknown as typeof query;
  const out = await runAgentLoop(req, queryFn);
  expect(out.status).toBe("error");
  expect(out.error).toContain("boom");
});

test("workspaceDir joins WORKSPACES_DIR with the workspace handle", () => {
  process.env.WORKSPACES_DIR = "/tmp/gilly-ws";
  expect(workspaceDir({ ...req, workspace: { provider: "local", handle: "s1" } })).toBe(
    "/tmp/gilly-ws/s1",
  );
  // No workspace → a stable "default" bucket.
  expect(workspaceDir(req)).toBe("/tmp/gilly-ws/default");
  delete process.env.WORKSPACES_DIR;
});

test("buildOptions: a tool-less agent stays chat-only (no cwd, plain prompt)", () => {
  const opts = buildOptions(req, false);
  expect(opts.allowedTools).toEqual([]);
  expect(opts.systemPrompt).toBe("do x");
  expect(opts.cwd).toBeUndefined();
  expect(opts.permissionMode).toBeUndefined();
  expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
  expect(opts.includePartialMessages).toBeUndefined();
});

test("buildOptions: granting tools enables a workspace + bypassed permissions", () => {
  process.env.WORKSPACES_DIR = "/tmp/gilly-ws";
  const coding: InvocationRequest = {
    ...req,
    // Gilly abstractions; the harness expands Read → Read/Glob/Grep before reaching the SDK.
    agent: { ...req.agent, tools: ["Read", "Bash"] },
    workspace: { provider: "local", handle: "s2" },
  };
  const opts = buildOptions(coding, false);
  expect(opts.allowedTools).toEqual(["Read", "Glob", "Grep", "Bash"]);
  expect(opts.permissionMode).toBe("bypassPermissions");
  expect(opts.allowDangerouslySkipPermissions).toBe(true);
  expect(opts.cwd).toBe("/tmp/gilly-ws/s2");
  expect(opts.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "do x" });
  delete process.env.WORKSPACES_DIR;
});

test("buildOptions: attaching a skill enables the Skill tool, a workspace, and the project source", () => {
  process.env.WORKSPACES_DIR = "/tmp/gilly-ws";
  const opts = buildOptions(
    {
      ...req,
      skills: [{ name: "cut-release", files: [] }],
      workspace: { provider: "local", handle: "s5" },
    },
    false,
  );
  expect(opts.allowedTools).toEqual(["Skill"]);
  expect(opts.settingSources).toEqual(["project"]);
  expect(opts.cwd).toBe("/tmp/gilly-ws/s5");
  expect(opts.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "do x" });
  delete process.env.WORKSPACES_DIR;
});

test("materializeSkills writes each file under <cwd>/.claude/skills/<name>/", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gilly-ws-"));
  materializeSkills(
    [
      {
        name: "cut-release",
        files: [
          { path: "SKILL.md", contents: "# go" },
          { path: "ref/x.md", contents: "hi" },
        ],
      },
    ],
    cwd,
  );
  expect(readFileSync(join(cwd, ".claude/skills/cut-release/SKILL.md"), "utf8")).toBe("# go");
  expect(readFileSync(join(cwd, ".claude/skills/cut-release/ref/x.md"), "utf8")).toBe("hi");
});

test("buildOptions: streaming adds partial messages, resume passes through", () => {
  const opts = buildOptions({ ...req, resumeSessionId: "h1" }, true);
  expect(opts.includePartialMessages).toBe(true);
  expect(opts.resume).toBe("h1");
});

test("summarizeToolUse picks the salient arg and truncates", () => {
  expect(summarizeToolUse({ command: "bun test" })).toBe("bun test");
  expect(summarizeToolUse({ skill: "cut-release" })).toBe("cut-release");
  expect(summarizeToolUse({ file_path: "src/index.ts" })).toBe("src/index.ts");
  expect(summarizeToolUse({ pattern: "TODO" })).toBe("TODO");
  expect(summarizeToolUse({ description: "review the PR" })).toBe("review the PR");
  expect(summarizeToolUse({ tool: "gilly.get_agent", input: { id: "coder" } })).toBe(
    "gilly.get_agent — coder",
  );
  expect(summarizeToolUse({ tool: "gilly.list_agents", input: {} })).toBe("gilly.list_agents");
  expect(
    summarizeToolUse({
      tool: "jira.searchJiraIssuesUsingJql",
      input: { cloudId: "ignored", jql: "project = DEV" },
    }),
  ).toBe("jira.searchJiraIssuesUsingJql — project = DEV");
  expect(summarizeToolUse({})).toBe("");
  expect(summarizeToolUse({ command: "x".repeat(200) }).length).toBe(118);
});

test("gatewayPost posts to url+path with a Bearer header and returns ok + parsed body", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ tools: ["a"] }), { status: 200 });
  }) as unknown as typeof fetch;

  const out = await gatewayPost("http://gw", "tok", "/catalog", { query: "x" }, fakeFetch);
  expect(out).toEqual({ ok: true, data: { tools: ["a"] } });
  expect(seen?.url).toBe("http://gw/catalog");
  const headers = seen?.init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer tok");
  expect(seen?.init.body).toBe(JSON.stringify({ query: "x" }));
});

test("gatewayMcpResult preserves the full structured error for the agent", () => {
  const result = gatewayMcpResult(true, {
    error: "user_missing_grant",
    tool: "echo.ping",
    message: "Stop and inform the user.",
  });
  expect(result).toEqual({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: "user_missing_grant",
          tool: "echo.ping",
          message: "Stop and inform the user.",
        }),
      },
    ],
    isError: true,
  });
});

test("makeGatewayMcpServer builds an sdk server named `gateway`", () => {
  const server = makeGatewayMcpServer({ url: "http://gw", token: "tok" }) as {
    type: string;
    name: string;
  };
  expect(server.type).toBe("sdk");
  expect(server.name).toBe("gateway");
});

test("buildOptions: a gateway wires the two MCP tools, the server, and env (keeping process.env)", () => {
  process.env.PATH = process.env.PATH ?? "/usr/bin";
  const opts = buildOptions({ ...req, gateway: { url: "http://gw", token: "tok" } }, false);
  expect(opts.allowedTools).toEqual([
    "mcp__gateway__gateway_catalog",
    "mcp__gateway__gateway_invoke",
  ]);
  expect(opts.mcpServers?.gateway).toBeDefined();
  expect(opts.env?.GILLY_GATEWAY_URL).toBe("http://gw");
  expect(opts.env?.GILLY_GATEWAY_TOKEN).toBe("tok");
  expect(opts.env?.PATH).toBe(process.env.PATH); // process.env spread survives
  // Gateway alone is agentic: bypassed permissions, but no workspace forced.
  expect(opts.permissionMode).toBe("bypassPermissions");
  expect(opts.cwd).toBeUndefined();
});

test("buildOptions: no gateway → no mcpServers, no gateway env, no gateway tools", () => {
  const opts = buildOptions(req, false);
  expect(opts.mcpServers).toBeUndefined();
  expect(opts.env).toBeUndefined();
  expect(opts.allowedTools).toEqual([]);
});

test("streamAgentLoop emits a tool event per tool_use block", async () => {
  const queryFn = (() =>
    stream(
      init("s3"),
      toolUse("Bash", { command: "ls" }),
      result("ok"),
    )) as unknown as typeof query;
  const events = [];
  for await (const ev of streamAgentLoop(req, queryFn)) events.push(ev);
  expect(events).toEqual([
    { type: "tool", name: "Bash", summary: "ls" },
    { type: "done", finalText: "ok", harnessSessionId: "s3" },
  ]);
});

test("streamAgentLoop surfaces a tool-turn's narration as a `message`, then its tools", async () => {
  const queryFn = (() =>
    stream(
      init("s4"),
      narrateThenTool("Let me check the file.", "Read", { file_path: "a.ts" }),
      result("the answer"),
    )) as unknown as typeof query;
  const events = [];
  for await (const ev of streamAgentLoop(req, queryFn)) events.push(ev);
  expect(events).toEqual([
    { type: "message", text: "Let me check the file." },
    { type: "tool", name: "Read", summary: "a.ts" },
    { type: "done", finalText: "the answer", harnessSessionId: "s4" },
  ]);
});

test("streamAgentLoop associates a separate narration payload with the following tools", async () => {
  const queryFn = (() =>
    stream(
      init("s5"),
      assistant("Let me inspect it."),
      toolUse("Read", { file_path: "one.ts" }),
      assistant("Now I’ll run the tests."),
      toolUse("Bash", { command: "bun test" }),
      assistant("Everything passed."),
      result("Everything passed."),
    )) as unknown as typeof query;
  const events = [];
  for await (const ev of streamAgentLoop(req, queryFn)) events.push(ev);
  expect(events).toEqual([
    { type: "message", text: "Let me inspect it." },
    { type: "tool", name: "Read", summary: "one.ts" },
    { type: "message", text: "Now I’ll run the tests." },
    { type: "tool", name: "Bash", summary: "bun test" },
    { type: "done", finalText: "Everything passed.", harnessSessionId: "s5" },
  ]);
});

test("streamAgentLoop does not surface a final text-only payload as progress", async () => {
  const queryFn = (() =>
    stream(
      init("s6"),
      assistant("The final answer."),
      result("The final answer."),
    )) as unknown as typeof query;
  const events = [];
  for await (const ev of streamAgentLoop(req, queryFn)) events.push(ev);
  expect(events).toEqual([
    { type: "done", finalText: "The final answer.", harnessSessionId: "s6" },
  ]);
});
