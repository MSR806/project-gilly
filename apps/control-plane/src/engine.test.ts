import { expect, test } from "bun:test";
import type { AgentConfig } from "@gilly/core";
import { createDb, enqueueFollowUp, getOrCreateSession } from "@gilly/db";
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

/** Lookup that knows only the echo agent — mirrors the DB-backed getAgent in prod. */
const getAgent = (id: string) => (id === "echo" ? agent : undefined);

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
    getAgent,
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
    getAgent,
  });

  const got = await collect(engine.stream({ ...baseInput, agentId: "nope", userMessage: "hi" }));
  expect(got).toEqual([{ type: "error", error: "Unknown agent: nope" }]);
});

test("handle streams the primary run and persists the harness session", async () => {
  const db = createDb(":memory:");
  const runtime = fakeRuntime(
    { status: "completed", finalText: "", harnessSessionId: null, error: null },
    [{ type: "done", finalText: "hello back", harnessSessionId: "hs-1" }],
  );
  const engine = createEngine({ db, runtime, getAgent });

  const runs: { refs: string[]; message: string; events: StreamEvent[] }[] = [];
  await engine.handle({
    ...baseInput,
    userMessage: "hi",
    ref: "ts1",
    run: async ({ refs, message, events }) => {
      runs.push({ refs, message, events: await collect(events) });
    },
  });

  expect(runs).toEqual([
    {
      refs: ["ts1"],
      message: "hi",
      events: [{ type: "done", finalText: "hello back", harnessSessionId: "hs-1" }],
    },
  ]);
  expect(getOrCreateSession(db, baseInput).harnessSessionId).toBe("hs-1");
});

test("handle surfaces an unknown agent as an error event", async () => {
  const db = createDb(":memory:");
  const engine = createEngine({
    db,
    runtime: fakeRuntime({
      status: "completed",
      finalText: "x",
      harnessSessionId: null,
      error: null,
    }),
    getAgent,
  });

  let events: StreamEvent[] = [];
  await engine.handle({
    ...baseInput,
    agentId: "nope",
    userMessage: "hi",
    run: async (ctx) => {
      events = await collect(ctx.events);
    },
  });
  expect(events).toEqual([{ type: "error", error: "Unknown agent: nope" }]);
});

test("follow-ups queued mid-run are answered as one combined batch", async () => {
  const db = createDb(":memory:");
  const session = getOrCreateSession(db, baseInput);
  let call = 0;
  const runtime: RuntimeProvider = {
    name: "fake",
    async invoke() {
      return { status: "completed", finalText: "", harnessSessionId: null, error: null };
    },
    async *invokeStream(req) {
      call += 1;
      if (call === 1) {
        // Two messages arrive while the first run is in flight.
        enqueueFollowUp(db, session.id, "msg2", "ts2");
        enqueueFollowUp(db, session.id, "msg3", "ts3");
      }
      yield { type: "done", finalText: `r:${req.userMessage}`, harnessSessionId: "h" };
    },
    async healthy() {
      return true;
    },
  };

  const engine = createEngine({ db, runtime, getAgent });
  const runs: { refs: string[]; message: string }[] = [];
  await engine.handle({
    ...baseInput,
    userMessage: "msg1",
    ref: "ts1",
    run: async ({ refs, message, events }) => {
      await collect(events); // consume so the Run is recorded + the queue advances
      runs.push({ refs, message });
    },
  });

  expect(runs).toEqual([
    { refs: ["ts1"], message: "msg1" },
    { refs: ["ts2", "ts3"], message: "msg2\n\nmsg3" },
  ]);
});
