import { expect, test } from "bun:test";
import { createSlackUpdateScheduler, slackRetryAfterMs } from "./slack-update-scheduler.ts";

type Update = {
  channel: string;
  ts: string;
  text: string;
};

function fakeClock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const update = (text: string, ts = "1"): Update => ({ channel: "C1", ts, text });

test("coalesces updates per message and globally paces concurrent messages", async () => {
  const clock = fakeClock();
  const sent: Array<{ text: string; at: number }> = [];
  const scheduler = createSlackUpdateScheduler<Update>({
    intervalMs: 2_000,
    now: clock.now,
    sleep: clock.sleep,
    send: async (item) => {
      sent.push({ text: item.text, at: clock.now() });
    },
  });

  scheduler.schedule(update("first"));
  await scheduler.flush("C1", "1");

  scheduler.schedule(update("old"));
  scheduler.schedule(update("latest"));
  scheduler.schedule(update("other", "2"));
  await Promise.all([scheduler.flush("C1", "1"), scheduler.flush("C1", "2")]);

  expect(sent).toEqual([
    { text: "first", at: 0 },
    { text: "latest", at: 2_000 },
    { text: "other", at: 4_000 },
  ]);
});

test("honors Slack Retry-After and retries the latest payload", async () => {
  const clock = fakeClock();
  const sent: string[] = [];
  let calls = 0;
  const scheduler = createSlackUpdateScheduler<Update>({
    now: clock.now,
    sleep: clock.sleep,
    send: async (item) => {
      calls += 1;
      sent.push(item.text);
      if (calls === 1) {
        throw Object.assign(new Error("rate limited"), {
          code: "slack_webapi_rate_limited_error",
          retryAfter: 3,
        });
      }
    },
  });

  scheduler.schedule(update("progress"));
  await scheduler.flush("C1", "1");

  expect(sent).toEqual(["progress", "progress"]);
  expect(clock.sleeps).toEqual([3_000]);
});

test("uses capped exponential backoff when Retry-After is unavailable", async () => {
  const clock = fakeClock();
  let failures = 4;
  const scheduler = createSlackUpdateScheduler<Update>({
    now: clock.now,
    sleep: clock.sleep,
    send: async () => {
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error("rate limited"), { statusCode: 429 });
      }
    },
  });

  scheduler.schedule(update("progress"));
  await scheduler.flush("C1", "1");

  expect(clock.sleeps).toEqual([2_000, 4_000, 8_000, 10_000]);
});

test("finalize replaces pending progress, waits for in-flight work, and closes the key", async () => {
  const clock = fakeClock();
  const firstSend = deferred();
  const sent: string[] = [];
  const scheduler = createSlackUpdateScheduler<Update>({
    now: clock.now,
    sleep: clock.sleep,
    send: async (item) => {
      sent.push(item.text);
      if (sent.length === 1) await firstSend.promise;
    },
  });

  scheduler.schedule(update("in flight"));
  await Promise.resolve();
  const finalized = scheduler.finalize(update("final"));
  scheduler.schedule(update("stale"));
  firstSend.resolve();
  await finalized;

  scheduler.schedule(update("after final"));
  await scheduler.flush("C1", "1");
  expect(sent).toEqual(["in flight", "final"]);
  expect(clock.sleeps).toEqual([2_000]);
});

test("cancel discards pending work and waits for an in-flight update", async () => {
  const firstSend = deferred();
  const sent: string[] = [];
  const scheduler = createSlackUpdateScheduler<Update>({
    send: async (item) => {
      sent.push(item.text);
      await firstSend.promise;
    },
  });

  scheduler.schedule(update("in flight"));
  await Promise.resolve();
  scheduler.schedule(update("pending"));
  let cancelled = false;
  const cancellation = scheduler.cancel("C1", "1").then(() => {
    cancelled = true;
  });
  await Promise.resolve();
  expect(cancelled).toBe(false);

  firstSend.resolve();
  await cancellation;
  expect(sent).toEqual(["in flight"]);
});

test("reports permanent delivery failures through flush and onError", async () => {
  const failure = new Error("not allowed");
  const errors: unknown[] = [];
  const scheduler = createSlackUpdateScheduler<Update>({
    send: async () => {
      throw failure;
    },
    onError: (error) => errors.push(error),
  });

  scheduler.schedule(update("progress"));
  await expect(scheduler.flush("C1", "1")).rejects.toBe(failure);
  expect(errors).toEqual([failure]);
});

test("ignores failures from scheduler diagnostics", async () => {
  const failure = new Error("not allowed");
  const scheduler = createSlackUpdateScheduler<Update>({
    send: async () => {
      throw failure;
    },
    onError: () => {
      throw new Error("logger failed");
    },
  });

  scheduler.schedule(update("progress"));
  await expect(scheduler.flush("C1", "1")).rejects.toBe(failure);
});

test("suppresses progress after a permanent failure but lets finalize try once", async () => {
  const clock = fakeClock();
  const sent: string[] = [];
  const scheduler = createSlackUpdateScheduler<Update>({
    now: clock.now,
    sleep: clock.sleep,
    send: async (item) => {
      sent.push(item.text);
      if (item.text === "broken") throw new Error("not allowed");
    },
  });

  scheduler.schedule(update("broken"));
  await expect(scheduler.flush("C1", "1")).rejects.toThrow("not allowed");
  scheduler.schedule(update("suppressed"));
  await expect(scheduler.flush("C1", "1")).rejects.toThrow("not allowed");
  await scheduler.finalize(update("final"));

  expect(sent).toEqual(["broken", "final"]);
});

test("extracts Retry-After from Slack error shapes", () => {
  expect(slackRetryAfterMs({ retryAfter: 2 })).toBe(2_000);
  expect(slackRetryAfterMs({ data: { retry_after: "3" } })).toBe(3_000);
  expect(slackRetryAfterMs({ response: { headers: { "retry-after": "4" } } })).toBe(4_000);
});
