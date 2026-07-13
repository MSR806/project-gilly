import { expect, test } from "bun:test";
import type { AgentConfig } from "@gilly/core";
import {
  addGrant,
  createDb,
  enqueueFollowUp,
  getGatewayToken,
  getOrCreateSession,
  getRun,
  listRunSteps,
  schema,
  setAdmin,
  upsertUserBySlackId,
} from "@gilly/db";
import type { InvocationRequest } from "@gilly/harness-protocol";
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

test("start returns immediately and completes the background run", async () => {
  const db = createDb(":memory:");
  let release: () => void = () => {};
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const runtime: RuntimeProvider = {
    name: "fake",
    async invoke() {
      return { status: "completed", finalText: "", harnessSessionId: null, error: null };
    },
    async *invokeStream() {
      try {
        await gate;
        yield { type: "message", text: "Inspecting" };
        yield { type: "tool", name: "Read", summary: "README.md" };
        yield { type: "token", text: "background " };
        yield { type: "done", finalText: "background done", harnessSessionId: null };
      } finally {
        finish();
      }
    },
    async healthy() {
      return true;
    },
  };
  const engine = createEngine({ db, runtime, getAgent });

  const { runId } = engine.start({ ...baseInput, source: "gateway", userMessage: "work" });
  expect(getRun(db, runId)?.status).toBe("running");

  release();
  await finished;
  expect(getRun(db, runId)).toMatchObject({ status: "completed", output: "background done" });
  expect(listRunSteps(db, runId)).toEqual([
    { type: "message", text: "Inspecting" },
    { type: "tool", name: "Read", summary: "README.md" },
  ]);
});

test("stream fails the run when the consumer stops before a terminal event", async () => {
  const db = createDb(":memory:");
  const engine = createEngine({
    db,
    runtime: fakeRuntime(
      { status: "completed", finalText: "", harnessSessionId: null, error: null },
      [
        { type: "tool", name: "Read", summary: "README.md" },
        { type: "done", finalText: "late", harnessSessionId: null },
      ],
    ),
    getAgent,
  });

  for await (const _ of engine.stream({ ...baseInput, userMessage: "hi" })) break;

  const [run] = db.select().from(schema.runs).all();
  expect(run?.status).toBe("error");
  expect(run?.error).toBe("Run interrupted before terminal event.");
  expect(listRunSteps(db, run?.id ?? "")).toEqual([
    { type: "tool", name: "Read", summary: "README.md" },
    { type: "error", error: "Run interrupted before terminal event." },
  ]);
});

test("stream fails the run when the runtime goes idle before a terminal event", async () => {
  const db = createDb(":memory:");
  const runtime: RuntimeProvider = {
    name: "fake",
    async invoke() {
      return { status: "completed", finalText: "", harnessSessionId: null, error: null };
    },
    async *invokeStream() {
      yield { type: "tool", name: "Read", summary: "README.md" };
      await new Promise(() => {});
    },
    async healthy() {
      return true;
    },
  };
  const engine = createEngine({ db, runtime, getAgent, runIdleTimeoutMs: 5 });

  const got = await collect(engine.stream({ ...baseInput, userMessage: "hi" }));

  expect(got).toEqual([
    { type: "tool", name: "Read", summary: "README.md" },
    { type: "error", error: "Run timed out waiting for the agent runtime." },
  ]);
  const [run] = db.select().from(schema.runs).all();
  expect(run?.status).toBe("error");
  expect(run?.error).toBe("Run timed out waiting for the agent runtime.");
  expect(listRunSteps(db, run?.id ?? "")).toEqual([
    { type: "tool", name: "Read", summary: "README.md" },
    { type: "error", error: "Run timed out waiting for the agent runtime." },
  ]);
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

// --- Gateway token minting -------------------------------------------------

const echoWithConnectors: AgentConfig = { ...agent, connectors: ["echo"] };

/** Fake runtime that captures the InvocationRequest (and resolves any gateway token while live). */
function capturingRuntime(db: ReturnType<typeof createDb>) {
  const seen: { req?: InvocationRequest; grants?: string[] } = {};
  const runtime: RuntimeProvider = {
    name: "fake",
    async invoke() {
      return { status: "completed", finalText: "", harnessSessionId: null, error: null };
    },
    async *invokeStream(req) {
      seen.req = req;
      // Resolve while the token is still live (cleanup fires on `done`).
      if (req.gateway) seen.grants = getGatewayToken(db, req.gateway.token)?.grants;
      yield { type: "done", finalText: "ok", harnessSessionId: null };
    },
    async healthy() {
      return true;
    },
  };
  return { runtime, seen };
}

test("mints a gateway token for a user whose grant matches an agent connector", async () => {
  const db = createDb(":memory:");
  const user = upsertUserBySlackId(db, { slackUserId: "U1", name: "U1" });
  addGrant(db, user.id, "echo.*");
  const { runtime, seen } = capturingRuntime(db);
  const engine = createEngine({
    db,
    runtime,
    getAgent: (id) => (id === "echo" ? echoWithConnectors : undefined),
    gatewayUrl: "http://gw",
  });

  await collect(engine.stream({ ...baseInput, userMessage: "hi", userId: user.id }));
  expect(seen.req?.gateway?.url).toBe("http://gw");
  expect(seen.req?.gateway?.token).toBeTruthy();
  expect(seen.grants).toEqual(["echo.*"]);
});

test("no gateway when the user's grants don't match the agent's connectors", async () => {
  const db = createDb(":memory:");
  const user = upsertUserBySlackId(db, { slackUserId: "U2", name: "U2" });
  addGrant(db, user.id, "gmail.*"); // agent only connects "echo"
  const { runtime, seen } = capturingRuntime(db);
  const engine = createEngine({
    db,
    runtime,
    getAgent: (id) => (id === "echo" ? echoWithConnectors : undefined),
    gatewayUrl: "http://gw",
  });

  await collect(engine.stream({ ...baseInput, userMessage: "hi", userId: user.id }));
  expect(seen.req?.gateway).toBeUndefined();
});

test("an admin bypasses grants: gets full access to the agent's connectors", async () => {
  const db = createDb(":memory:");
  const user = upsertUserBySlackId(db, { slackUserId: "admin", name: "Admin" });
  setAdmin(db, user.id, true); // no addGrant — admin needs none
  const { runtime, seen } = capturingRuntime(db);
  const engine = createEngine({
    db,
    runtime,
    getAgent: (id) => (id === "echo" ? echoWithConnectors : undefined),
    gatewayUrl: "http://gw",
  });

  await collect(engine.stream({ ...baseInput, userMessage: "hi", userId: user.id }));
  expect(seen.grants).toEqual(["echo.*"]);
});

test("no gateway when gatewayUrl is unset, even with a matching grant", async () => {
  const db = createDb(":memory:");
  const user = upsertUserBySlackId(db, { slackUserId: "U3", name: "U3" });
  addGrant(db, user.id, "echo.*");
  const { runtime, seen } = capturingRuntime(db);
  const engine = createEngine({
    db,
    runtime,
    getAgent: (id) => (id === "echo" ? echoWithConnectors : undefined),
  });

  await collect(engine.stream({ ...baseInput, userMessage: "hi", userId: user.id }));
  expect(seen.req?.gateway).toBeUndefined();
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
