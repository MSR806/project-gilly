import { expect, test } from "bun:test";
import type { query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { InvocationRequest } from "@gilly/harness-protocol";
import {
  buildOptions,
  reduceSdkStream,
  runAgentLoop,
  streamAgentLoop,
  summarizeToolUse,
  workspaceDir,
} from "./loop.ts";

// Minimal message factories; cast since we only populate the fields the reducer reads.
const msg = (o: unknown) => o as SDKMessage;
const init = (id: string) => msg({ type: "system", subtype: "init", session_id: id });
const assistant = (text: string) =>
  msg({ type: "assistant", message: { content: [{ type: "text", text }] } });
const result = (text: string) => msg({ type: "result", subtype: "success", result: text });
const toolUse = (name: string, input: unknown) =>
  msg({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

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
    agent: { ...req.agent, tools: ["Read", "Bash"] },
    workspace: { provider: "local", handle: "s2" },
  };
  const opts = buildOptions(coding, false);
  expect(opts.allowedTools).toEqual(["Read", "Bash"]);
  expect(opts.permissionMode).toBe("bypassPermissions");
  expect(opts.allowDangerouslySkipPermissions).toBe(true);
  expect(opts.cwd).toBe("/tmp/gilly-ws/s2");
  expect(opts.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "do x" });
  delete process.env.WORKSPACES_DIR;
});

test("buildOptions: streaming adds partial messages, resume passes through", () => {
  const opts = buildOptions({ ...req, resumeSessionId: "h1" }, true);
  expect(opts.includePartialMessages).toBe(true);
  expect(opts.resume).toBe("h1");
});

test("summarizeToolUse picks the salient arg and truncates", () => {
  expect(summarizeToolUse({ command: "bun test" })).toBe("bun test");
  expect(summarizeToolUse({ file_path: "src/index.ts" })).toBe("src/index.ts");
  expect(summarizeToolUse({ pattern: "TODO" })).toBe("TODO");
  expect(summarizeToolUse({})).toBe("");
  expect(summarizeToolUse({ command: "x".repeat(200) }).length).toBe(118);
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
