import { expect, test } from "bun:test";
import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
import { createServer } from "./server.ts";

const req = (path: string, init?: RequestInit) =>
  createServer().fetch(new Request(`http://localhost${path}`, init));

test("GET /ping returns Healthy", async () => {
  const res = await req("/ping");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "Healthy" });
});

test("POST /invocations rejects a malformed body with 400", async () => {
  const res = await createServer().fetch(
    new Request("http://localhost/invocations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    }),
  );
  expect(res.status).toBe(400);
});

test("POST /invocations runs the loop and returns its result", async () => {
  const canned: InvocationResult = {
    status: "completed",
    finalText: "hi there",
    harnessSessionId: "sess-1",
    error: null,
  };
  const server = createServer(async (_r: InvocationRequest) => canned);
  const valid: InvocationRequest = {
    agent: { id: "a", name: "A", model: "claude-sonnet-4-5", systemPrompt: "do x" },
    userMessage: "hello",
  };
  const res = await server.fetch(
    new Request("http://localhost/invocations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
    }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(canned);
});

test("POST /invocations/stream streams NDJSON events", async () => {
  async function* fakeStream(): AsyncIterable<StreamEvent> {
    yield { type: "token", text: "hel" };
    yield { type: "token", text: "lo" };
    yield { type: "done", finalText: "hello", harnessSessionId: "sess-1" };
  }
  const server = createServer(undefined, fakeStream);
  const valid: InvocationRequest = {
    agent: { id: "a", name: "A", model: "claude-sonnet-4-5", systemPrompt: "do x" },
    userMessage: "hello",
  };
  const res = await server.fetch(
    new Request("http://localhost/invocations/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid),
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/x-ndjson");
  const body = await res.text();
  const events = body
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as StreamEvent);
  expect(events).toEqual([
    { type: "token", text: "hel" },
    { type: "token", text: "lo" },
    { type: "done", finalText: "hello", harnessSessionId: "sess-1" },
  ]);
});
