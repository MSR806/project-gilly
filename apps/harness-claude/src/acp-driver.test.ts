import { expect, test } from "bun:test";
import type { InvocationRequest } from "@gilly/harness-protocol";
import {
  AcpDriver,
  type AcpTransport,
  buildInitialize,
  buildSessionLoad,
  buildSessionNew,
  buildSessionPrompt,
  buildSessionResume,
  parseAcpLine,
  resetIdCounter,
} from "./acp-driver.ts";

// Reset ID counter before each test for deterministic IDs
function setup() {
  resetIdCounter();
}

const req: InvocationRequest = {
  agent: { id: "a", name: "Agent", model: "claude-sonnet-4-5", systemPrompt: "be helpful" },
  userMessage: "hello world",
  workspace: { provider: "local", handle: "/my-workspace" },
  resumeSessionId: "sess-prev",
};

const minimalReq: InvocationRequest = {
  agent: { id: "a", name: "A", model: "claude-sonnet-4-5", systemPrompt: "x" },
  userMessage: "hi",
};

// ─── Pure builder tests ───────────────────────────────────────────────────────

test("buildInitialize produces correct method and params", () => {
  setup();
  const msg = buildInitialize();
  expect(msg.method).toBe("initialize");
  expect(msg.params.protocolVersion).toBe(1);
  expect(msg.params.clientCapabilities).toEqual({});
  expect(msg.params.clientInfo).toEqual({ name: "gilly-harness", version: "1.0.0" });
  expect(msg.id).toBe(1);
});

test("buildSessionNew produces correct method and params", () => {
  setup();
  const msg = buildSessionNew("/workspace");
  expect(msg.method).toBe("session/new");
  expect(msg.params).toEqual({ cwd: "/workspace", mcpServers: [] });
});

test("buildSessionResume produces correct method and params", () => {
  setup();
  const msg = buildSessionResume("sess-1", "/ws");
  expect(msg.method).toBe("session/resume");
  expect(msg.params).toEqual({ sessionId: "sess-1", cwd: "/ws", mcpServers: [] });
});

test("buildSessionLoad produces correct method and params", () => {
  setup();
  const msg = buildSessionLoad("sess-1", "/ws");
  expect(msg.method).toBe("session/load");
  expect(msg.params).toEqual({ sessionId: "sess-1", cwd: "/ws", mcpServers: [] });
});

test("buildSessionPrompt produces correct method and params", () => {
  setup();
  const msg = buildSessionPrompt("sess-1", "hello");
  expect(msg.method).toBe("session/prompt");
  expect(msg.params).toEqual({
    sessionId: "sess-1",
    prompt: [{ type: "text", text: "hello" }],
  });
});

// ─── parseAcpLine tests ───────────────────────────────────────────────────────

test("parseAcpLine: agent_message_chunk notification → token event", () => {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
    },
  });
  const ev = parseAcpLine(line);
  expect(ev).toEqual({ type: "token", text: "hello" });
});

test("parseAcpLine: tool_call notification → tool event", () => {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call", title: "Bash", kind: "shell", status: "running" },
    },
  });
  const ev = parseAcpLine(line);
  expect(ev).toEqual({ type: "tool", name: "Bash", summary: "shell — running" });
});

test("parseAcpLine: tool_call with only title", () => {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call", title: "Read" },
    },
  });
  const ev = parseAcpLine(line);
  expect(ev).toEqual({ type: "tool", name: "Read", summary: "" });
});

test("parseAcpLine: JSON-RPC result", () => {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    result: { stopReason: "end_turn" },
  });
  const ev = parseAcpLine(line);
  expect(ev).toEqual({ _rpcResult: { stopReason: "end_turn" }, id: 3 });
});

test("parseAcpLine: JSON-RPC error", () => {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    error: { code: -1, message: "something broke" },
  });
  const ev = parseAcpLine(line);
  expect(ev).toEqual({ _rpcError: "something broke", id: 2 });
});

test("parseAcpLine: unknown line returns null", () => {
  expect(parseAcpLine("not json")).toBeNull();
  expect(parseAcpLine(JSON.stringify({ jsonrpc: "2.0" }))).toBeNull();
});

// ─── Fake transport helper ────────────────────────────────────────────────────

interface FakeTransport extends AcpTransport {
  sentMessages: string[];
  receiveCalls: number;
}

/**
 * A transport that yields lines from a shared queue.
 * Supports multiple calls to receive() sharing the same underlying queue.
 * Each receive() call drains lines until the queue is empty.
 */
function fakeSharedTransport(responses: string[]): FakeTransport {
  const sent: string[] = [];
  const queue = [...responses];
  let receiveCalls = 0;
  return {
    send(msg: string) {
      sent.push(msg);
    },
    async *receive() {
      receiveCalls += 1;
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) yield item;
      }
    },
    close() {},
    get sentMessages() {
      return sent;
    },
    get receiveCalls() {
      return receiveCalls;
    },
  };
}

// ─── Integration: method sequence ─────────────────────────────────────────────

test("AcpDriver sends initialize → session/new → session/prompt for fresh session", async () => {
  setup();
  const transport = fakeSharedTransport([
    // initialize response
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: 1, agentCapabilities: {} },
    }),
    // session/new response
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { sessionId: "new-sess-1" },
    }),
    // session/update notification (agent_message_chunk)
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "new-sess-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi there" },
        },
      },
    }),
    // session/prompt response
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      result: { stopReason: "end_turn" },
    }),
  ]);

  const driver = new AcpDriver(() => transport);
  const result = await driver.invoke(minimalReq);

  // Verify method sequence
  expect(transport.sentMessages).toHaveLength(3);
  const [initMsg, sessionMsg, promptMsg] = transport.sentMessages.map((m) => JSON.parse(m));
  expect(initMsg.method).toBe("initialize");
  expect(sessionMsg.method).toBe("session/new");
  expect(sessionMsg.params.cwd).toBe("/workspace");
  expect(sessionMsg.params.mcpServers).toEqual([]);
  expect(promptMsg.method).toBe("session/prompt");
  expect(promptMsg.params.sessionId).toBe("new-sess-1");
  expect(promptMsg.params.prompt).toEqual([{ type: "text", text: "hi" }]);
  expect(transport.receiveCalls).toBe(1);

  // Verify result
  expect(result).toEqual({
    status: "completed",
    finalText: "hi there",
    harnessSessionId: "new-sess-1",
    error: null,
  });
});

test("AcpDriver sends session/resume when agent supports resume capability", async () => {
  setup();
  const transport = fakeSharedTransport([
    // initialize response with resume capability
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { resume: true } },
      },
    }),
    // session/resume response
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { sessionId: "sess-prev" },
    }),
    // session/prompt response
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      result: { stopReason: "end_turn" },
    }),
  ]);

  const driver = new AcpDriver(() => transport);
  await driver.invoke(req);

  const [_, sessionMsg] = transport.sentMessages.map((m) => JSON.parse(m));
  expect(sessionMsg.method).toBe("session/resume");
  expect(sessionMsg.params.sessionId).toBe("sess-prev");
  expect(sessionMsg.params.cwd).toBe("/my-workspace");
});

test("AcpDriver sends session/load when agent supports loadSession but not resume", async () => {
  setup();
  const transport = fakeSharedTransport([
    // initialize response with loadSession but no resume
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
      },
    }),
    // session/load response
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { sessionId: "sess-prev" },
    }),
    // session/prompt response
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      result: { stopReason: "end_turn" },
    }),
  ]);

  const driver = new AcpDriver(() => transport);
  await driver.invoke(req);

  const [_, sessionMsg] = transport.sentMessages.map((m) => JSON.parse(m));
  expect(sessionMsg.method).toBe("session/load");
  expect(sessionMsg.params.sessionId).toBe("sess-prev");
});

test("AcpDriver falls back to session/new when resumeSessionId set but no capabilities", async () => {
  setup();
  const transport = fakeSharedTransport([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: 1, agentCapabilities: {} },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { sessionId: "fresh-sess" },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      result: { stopReason: "end_turn" },
    }),
  ]);

  const driver = new AcpDriver(() => transport);
  await driver.invoke(req);

  const [_, sessionMsg] = transport.sentMessages.map((m) => JSON.parse(m));
  expect(sessionMsg.method).toBe("session/new");
});

// ─── Streaming tests ──────────────────────────────────────────────────────────

test("AcpDriver.invokeStream yields token, tool, and done events", async () => {
  setup();
  const transport = fakeSharedTransport([
    // initialize
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: 1, agentCapabilities: {} },
    }),
    // session/new
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { sessionId: "s5" },
    }),
    // notifications
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s5",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a" } },
      },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s5",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "b" } },
      },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s5",
        update: { sessionUpdate: "tool_call", title: "Read", kind: "file", status: "done" },
      },
    }),
    // prompt result
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      result: { stopReason: "end_turn" },
    }),
  ]);

  const driver = new AcpDriver(() => transport);
  const events = [];
  for await (const ev of driver.invokeStream(minimalReq)) events.push(ev);

  expect(events).toEqual([
    { type: "token", text: "a" },
    { type: "token", text: "b" },
    { type: "tool", name: "Read", summary: "file — done" },
    { type: "done", finalText: "ab", harnessSessionId: "s5" },
  ]);
});

test("AcpDriver.invokeStream yields error on JSON-RPC error during prompt", async () => {
  setup();
  const transport = fakeSharedTransport([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: 1, agentCapabilities: {} },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      result: { sessionId: "s1" },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "partial" },
        },
      },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000, message: "process died" },
    }),
  ]);

  const driver = new AcpDriver(() => transport);
  const events = [];
  for await (const ev of driver.invokeStream(minimalReq)) events.push(ev);

  expect(events).toEqual([
    { type: "token", text: "partial" },
    { type: "error", error: "process died" },
  ]);
});

test("AcpDriver.invoke returns error when initialize fails", async () => {
  setup();
  const transport = fakeSharedTransport([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -1, message: "unsupported protocol" },
    }),
  ]);

  const driver = new AcpDriver(() => transport);
  const result = await driver.invoke(minimalReq);
  expect(result.status).toBe("error");
  expect(result.error).toContain("unsupported protocol");
});
