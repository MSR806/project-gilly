import { expect, test } from "bun:test";
import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
import { createServer, type HarnessRunners } from "./server.ts";

const completed = (finalText: string): InvocationResult => ({
  status: "completed",
  finalText,
  harnessSessionId: null,
  error: null,
});

const emptyStream = async function* (): AsyncIterable<StreamEvent> {};

function request(harnessId: string): InvocationRequest {
  return {
    agent: {
      id: "a",
      name: "A",
      harness: { id: harnessId, config: { model: "test-model" } },
      systemPrompt: "do x",
    },
    userMessage: "hello",
  };
}

function runners(
  claudeRun: HarnessRunners["claude"]["runLoop"] = async () => completed("claude"),
  codexRun: HarnessRunners["codex"]["runLoop"] = async () => completed("codex"),
): HarnessRunners {
  return {
    claude: { runLoop: claudeRun, runStream: emptyStream },
    codex: { runLoop: codexRun, runStream: emptyStream },
  };
}

test("GET /ping returns Healthy", async () => {
  const res = await createServer(runners()).fetch(new Request("http://localhost/ping"));
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

test("POST /invocations dispatches only by explicit agent harness id", async () => {
  const called: string[] = [];
  const server = createServer(
    runners(
      async () => {
        called.push("claude");
        return completed("claude");
      },
      async () => {
        called.push("codex");
        return completed("codex");
      },
    ),
  );

  for (const invocation of [request("claude"), request("codex")]) {
    const res = await server.fetch(
      new Request("http://localhost/invocations", {
        method: "POST",
        body: JSON.stringify(invocation),
      }),
    );
    expect(res.status).toBe(200);
  }
  expect(called).toEqual(["claude", "codex"]);
});

test("POST /invocations rejects an uncompiled harness with a stable 400", async () => {
  const res = await createServer(runners()).fetch(
    new Request("http://localhost/invocations", {
      method: "POST",
      body: JSON.stringify(request("custom")),
    }),
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'Unknown harness runner: "custom"' });
});

test("POST /invocations/stream forwards cancellation and closes its source", async () => {
  let cancelled = false;
  let aborted = false;
  async function* codexStream(
    _request: InvocationRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    signal?.addEventListener("abort", () => {
      aborted = true;
    });
    try {
      yield { type: "token", text: "hello" };
      await new Promise(() => {});
    } finally {
      cancelled = true;
    }
  }
  const configured = runners();
  configured.codex.runStream = codexStream;
  const res = await createServer(configured).fetch(
    new Request("http://localhost/invocations/stream", {
      method: "POST",
      body: JSON.stringify(request("codex")),
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/x-ndjson");
  const reader = res.body?.getReader();
  expect(new TextDecoder().decode((await reader?.read())?.value)).toBe(
    '{"type":"token","text":"hello"}\n',
  );
  await reader?.cancel();
  expect(aborted).toBe(true);
  expect(cancelled).toBe(true);
});
