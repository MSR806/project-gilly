import { expect, test } from "bun:test";
import type { AgentConfig } from "@gilly/core";
import { createDb, getOrCreateSession } from "@gilly/db";
import type { RuntimeProvider, StreamEvent } from "@gilly/runtime";
import { createEngine } from "./engine.ts";

type InvocationResult = Awaited<ReturnType<RuntimeProvider["invoke"]>>;

const agent: AgentConfig = {
  id: "echo",
  name: "Echo",
  model: "claude-sonnet-4-5",
  systemPrompt: "Be terse.",
};

function fakeRuntime(result: InvocationResult, events: StreamEvent[] = []): RuntimeProvider {
  return {
    name: "fake",
    async invoke() {
      return result;
    },
    async *invokeStream() {
      yield* events;
    },
    async healthy() {
      return true;
    },
  };
}

const baseInput = { agentId: "echo", source: "test", sourceKey: "C1:1.0" };

test("normal message replies with finalText and persists harness session", async () => {
  const db = createDb(":memory:");
  const runtime = fakeRuntime({
    status: "completed",
    finalText: "hello back",
    harnessSessionId: "hs-1",
    error: null,
  });
  const engine = createEngine({ db, runtime, agents: new Map([["echo", agent]]) });

  const replies: string[] = [];
  await engine.handle({
    ...baseInput,
    userMessage: "hi",
    reply: async (t) => void replies.push(t),
  });

  expect(replies).toEqual(["hello back"]);
  const session = getOrCreateSession(db, baseInput);
  expect(session.harnessSessionId).toBe("hs-1");
});

test("unknown agent id replies with the unknown-agent message", async () => {
  const db = createDb(":memory:");
  const engine = createEngine({
    db,
    runtime: fakeRuntime({
      status: "completed",
      finalText: "x",
      harnessSessionId: null,
      error: null,
    }),
    agents: new Map([["echo", agent]]),
  });

  const replies: string[] = [];
  await engine.handle({
    ...baseInput,
    agentId: "nope",
    userMessage: "hi",
    reply: async (t) => void replies.push(t),
  });

  expect(replies).toEqual(["Unknown agent: nope"]);
});

const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

test("stream forwards events and persists session + run on done", async () => {
  const db = createDb(":memory:");
  const events: StreamEvent[] = [
    { type: "token", text: "hel" },
    { type: "token", text: "lo" },
    { type: "done", finalText: "hello", harnessSessionId: "hs-9" },
  ];
  const engine = createEngine({
    db,
    runtime: fakeRuntime(
      { status: "completed", finalText: "", harnessSessionId: null, error: null },
      events,
    ),
    agents: new Map([["echo", agent]]),
  });

  const got = await collect(engine.stream({ ...baseInput, userMessage: "hi" }));
  expect(got).toEqual(events);
  expect(getOrCreateSession(db, baseInput).harnessSessionId).toBe("hs-9");
});

test("stream yields an error event for an unknown agent", async () => {
  const db = createDb(":memory:");
  const engine = createEngine({
    db,
    runtime: fakeRuntime({
      status: "completed",
      finalText: "x",
      harnessSessionId: null,
      error: null,
    }),
    agents: new Map([["echo", agent]]),
  });

  const got = await collect(engine.stream({ ...baseInput, agentId: "nope", userMessage: "hi" }));
  expect(got).toEqual([{ type: "error", error: "Unknown agent: nope" }]);
});
