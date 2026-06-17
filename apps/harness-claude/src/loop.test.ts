import { expect, test } from "bun:test";
import type { query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { InvocationRequest } from "@gilly/harness-protocol";
import { reduceSdkStream, runAgentLoop } from "./loop.ts";

// Minimal message factories; cast since we only populate the fields the reducer reads.
const msg = (o: unknown) => o as SDKMessage;
const init = (id: string) => msg({ type: "system", subtype: "init", session_id: id });
const assistant = (text: string) =>
  msg({ type: "assistant", message: { content: [{ type: "text", text }] } });
const result = (text: string) => msg({ type: "result", subtype: "success", result: text });

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
