import { expect, test } from "bun:test";
import type { InvocationRequest, StreamEvent } from "@gilly/harness-protocol";
import {
  AcpHarnessDriver,
  type AcpSession,
  buildPromptContent,
  type SessionMessage,
  translateUpdate,
} from "./acp-driver.ts";

const req: InvocationRequest = {
  agent: { id: "a", name: "A", model: "claude-sonnet-4-5", systemPrompt: "do x" },
  userMessage: "hello world",
  workspace: { provider: "local", handle: "ws-1" },
};

// --- Translation helpers ---

test("buildPromptContent returns the user message as a text content block", () => {
  expect(buildPromptContent(req)).toEqual([{ type: "text", text: "hello world" }]);
});

test("translateUpdate: agent_message_chunk with text → token event", () => {
  const update = {
    sessionUpdate: "agent_message_chunk" as const,
    content: { type: "text" as const, text: "hi" },
  };
  expect(translateUpdate(update)).toEqual({ type: "token", text: "hi" });
});

test("translateUpdate: agent_message_chunk with non-text content → null", () => {
  const update = {
    sessionUpdate: "agent_message_chunk" as const,
    content: { type: "image" as const, data: "abc", mimeType: "image/png" },
  };
  expect(translateUpdate(update)).toBeNull();
});

test("translateUpdate: tool_call → tool event", () => {
  const update = {
    sessionUpdate: "tool_call" as const,
    toolCallId: "tc-1",
    title: "Running command: ls -la",
  };
  expect(translateUpdate(update)).toEqual({
    type: "tool",
    name: "tool_call",
    summary: "Running command: ls -la",
  });
});

test("translateUpdate: unhandled update type → null", () => {
  const update = {
    sessionUpdate: "plan" as const,
    planId: "p-1",
    title: "My plan",
    steps: [],
  };
  expect(translateUpdate(update)).toBeNull();
});

// --- Driver with fake transport ---

/** Builds a fake AcpHarnessDriver that uses an injected session factory. */
function fakeAcpDriver(opts: {
  sessionId?: string;
  updates?: Array<SessionMessage>;
  stopResponse?: { stopReason: string };
  error?: string;
}) {
  const sessionId = opts.sessionId ?? "acp-sess-1";
  const updates = opts.updates ?? [];
  const stopResponse = opts.stopResponse ?? { stopReason: "end_turn" };

  // The driver receives a createSession factory for testing
  const fakeCreateSession = async (_req: InvocationRequest): Promise<AcpSession> => ({
    sessionId,
    async *messages(): AsyncIterable<SessionMessage> {
      for (const u of updates) {
        yield u;
      }
      yield { kind: "stop", response: stopResponse, stopReason: stopResponse.stopReason };
    },
  });

  return new AcpHarnessDriver({
    command: "/usr/bin/fake-agent",
    args: [],
    createSession: fakeCreateSession,
  });
}

test("AcpHarnessDriver.invoke returns completed result with accumulated text", async () => {
  const driver = fakeAcpDriver({
    sessionId: "acp-1",
    updates: [
      {
        kind: "session_update",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } },
      },
      {
        kind: "session_update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "world" },
        },
      },
    ],
  });
  const result = await driver.invoke(req);
  expect(result).toEqual({
    status: "completed",
    finalText: "Hello world",
    harnessSessionId: "acp-1",
    error: null,
  });
});

test("AcpHarnessDriver.invoke returns error result on failure", async () => {
  const driver = new AcpHarnessDriver({
    command: "/usr/bin/fake-agent",
    args: [],
    createSession: async () => {
      throw new Error("spawn failed");
    },
  });
  const result = await driver.invoke(req);
  expect(result.status).toBe("error");
  expect(result.error).toContain("spawn failed");
});

test("AcpHarnessDriver.invokeStream yields token and done events", async () => {
  const driver = fakeAcpDriver({
    sessionId: "acp-2",
    updates: [
      {
        kind: "session_update",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } },
      },
      {
        kind: "session_update",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-1",
          title: "Read file.ts",
        },
      },
    ],
  });
  const events: StreamEvent[] = [];
  for await (const ev of driver.invokeStream(req)) events.push(ev);
  expect(events).toEqual([
    { type: "token", text: "Hi" },
    { type: "tool", name: "tool_call", summary: "Read file.ts" },
    { type: "done", finalText: "Hi", harnessSessionId: "acp-2" },
  ]);
});

test("AcpHarnessDriver.invokeStream yields error event on failure", async () => {
  const driver = new AcpHarnessDriver({
    command: "/usr/bin/fake-agent",
    args: [],
    createSession: async () => {
      throw new Error("connection refused");
    },
  });
  const events: StreamEvent[] = [];
  for await (const ev of driver.invokeStream(req)) events.push(ev);
  expect(events).toEqual([{ type: "error", error: "Error: connection refused" }]);
});
