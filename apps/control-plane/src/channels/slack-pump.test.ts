import { expect, test } from "bun:test";
import type { StreamEvent } from "@gilly/runtime";
import { pumpSlackRun, type SlackRunDelivery } from "./slack-pump.ts";

async function* stream(events: StreamEvent[], onFinally?: () => void) {
  try {
    yield* events;
  } finally {
    onFinally?.();
  }
}

function fakeDelivery(overrides: Partial<SlackRunDelivery> = {}) {
  const progress: string[] = [];
  const finished: unknown[] = [];
  const posted: unknown[] = [];
  const delivery: SlackRunDelivery = {
    async startProgress(text) {
      progress.push(text);
      return "100.001";
    },
    queueProgress(_messageTs, text) {
      progress.push(text);
    },
    async finishProgress(_messageTs, message) {
      finished.push(message);
    },
    async postFinal(message) {
      posted.push(message);
    },
    ...overrides,
  };
  return { delivery, progress, finished, posted };
}

test("pumpSlackRun consumes one run and replaces progress with the final answer", async () => {
  let closed = 0;
  const fake = fakeDelivery();
  const result = await pumpSlackRun({
    events: stream(
      [
        { type: "tool", name: "Read", summary: "README.md" },
        { type: "token", text: "hel" },
        { type: "token", text: "lo" },
        { type: "done", finalText: "hello", harnessSessionId: null },
      ],
      () => {
        closed += 1;
      },
    ),
    delivery: fake.delivery,
  });

  expect(result).toEqual({ final: "hello", errored: false });
  expect(closed).toBe(1);
  expect(fake.progress.at(-1)).toContain("Read");
  expect(fake.finished).toEqual([{ blocks: [{ type: "markdown", text: "hello" }], text: "hello" }]);
  expect(fake.posted).toEqual([]);
});

test("pumpSlackRun continues consuming after progress delivery fails", async () => {
  let yielded = 0;
  const errors: string[] = [];
  async function* events(): AsyncGenerator<StreamEvent> {
    yielded += 1;
    yield { type: "tool", name: "Read", summary: "one" };
    yielded += 1;
    yield { type: "tool", name: "Read", summary: "two" };
    yielded += 1;
    yield { type: "done", finalText: "finished", harnessSessionId: null };
  }
  const fake = fakeDelivery({
    queueProgress() {
      throw new Error("Slack unavailable");
    },
  });

  const result = await pumpSlackRun({
    events: events(),
    delivery: fake.delivery,
    onDeliveryError: (message) => errors.push(message),
  });

  expect(yielded).toBe(3);
  expect(result.final).toBe("finished");
  expect(errors).toEqual(["failed to queue progress update"]);
  expect(fake.finished).toHaveLength(1);
});

test("pumpSlackRun posts every final segment when replacing progress fails", async () => {
  const fake = fakeDelivery({
    async finishProgress() {
      throw new Error("cannot update");
    },
  });
  const finalText = `${"a".repeat(11_000)}\n\n${"b".repeat(2_000)}`;

  await pumpSlackRun({
    events: stream([{ type: "done", finalText, harnessSessionId: null }]),
    delivery: fake.delivery,
  });

  expect(fake.finished).toEqual([]);
  expect(fake.posted.length).toBe(2);
});

test("pumpSlackRun posts the final answer when the progress message cannot start", async () => {
  const fake = fakeDelivery({
    async startProgress() {
      throw new Error("cannot post progress");
    },
  });

  const result = await pumpSlackRun({
    events: stream([{ type: "error", error: "runtime failed" }]),
    delivery: fake.delivery,
  });

  expect(result).toEqual({ final: "⚠️ runtime failed", errored: true });
  expect(fake.finished).toEqual([]);
  expect(fake.posted).toHaveLength(1);
});

test("pumpSlackRun uses accumulated tokens when done has an empty final answer", async () => {
  const fake = fakeDelivery();

  const result = await pumpSlackRun({
    events: stream([
      { type: "token", text: "fallback answer" },
      { type: "done", finalText: "", harnessSessionId: null },
    ]),
    delivery: fake.delivery,
  });

  expect(result.final).toBe("fallback answer");
  expect(fake.finished).toEqual([
    {
      blocks: [{ type: "markdown", text: "fallback answer" }],
      text: "fallback answer",
    },
  ]);
});

test("pumpSlackRun ignores failures from delivery diagnostics", async () => {
  let yielded = 0;
  async function* events(): AsyncGenerator<StreamEvent> {
    yielded += 1;
    yield { type: "tool", name: "Read", summary: "README.md" };
    yielded += 1;
    yield { type: "done", finalText: "finished", harnessSessionId: null };
  }
  const fake = fakeDelivery({
    queueProgress() {
      throw new Error("Slack unavailable");
    },
  });

  const result = await pumpSlackRun({
    events: events(),
    delivery: fake.delivery,
    onDeliveryError: () => {
      throw new Error("logger failed");
    },
  });

  expect(yielded).toBe(2);
  expect(result.final).toBe("finished");
});

test("pumpSlackRun stops posting final segments after a failed segment", async () => {
  let posts = 0;
  const fake = fakeDelivery({
    async startProgress() {
      throw new Error("no progress message");
    },
    async postFinal() {
      posts += 1;
      throw new Error("post failed");
    },
  });

  await pumpSlackRun({
    events: stream([{ type: "done", finalText: "x".repeat(25_000), harnessSessionId: null }]),
    delivery: fake.delivery,
  });

  expect(posts).toBe(1);
});
