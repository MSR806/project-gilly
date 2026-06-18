import { expect, test } from "bun:test";
import { createDb } from "./client.ts";
import {
  completeRun,
  createRun,
  dequeueAllFollowUps,
  dequeueFollowUp,
  enqueueFollowUp,
  getOrCreateSession,
  hasActiveRun,
} from "./repo.ts";

const freshDb = () => createDb(":memory:");
const seed = { agentId: "a", source: "slack", sourceKey: "C1:1.0" };

test("getOrCreateSession is idempotent on sourceKey", () => {
  const db = freshDb();
  const s1 = getOrCreateSession(db, seed);
  const s2 = getOrCreateSession(db, seed);
  expect(s2.id).toBe(s1.id);
});

test("one active run per session is observable", () => {
  const db = freshDb();
  const s = getOrCreateSession(db, seed);
  const run = createRun(db, s.id, "hi");
  expect(hasActiveRun(db, s.id)).toBe(true);
  completeRun(db, run.id, "done");
  expect(hasActiveRun(db, s.id)).toBe(false);
});

test("follow-ups dequeue FIFO", () => {
  const db = freshDb();
  const s = getOrCreateSession(db, seed);
  enqueueFollowUp(db, s.id, "first");
  enqueueFollowUp(db, s.id, "second");
  expect(dequeueFollowUp(db, s.id)?.input).toBe("first");
  expect(dequeueFollowUp(db, s.id)?.input).toBe("second");
  expect(dequeueFollowUp(db, s.id)).toBeNull();
});

test("dequeueAllFollowUps drains the whole queue (FIFO) with refs and empties it", () => {
  const db = freshDb();
  const s = getOrCreateSession(db, seed);
  enqueueFollowUp(db, s.id, "first", "ts1");
  enqueueFollowUp(db, s.id, "second", "ts2");
  expect(dequeueAllFollowUps(db, s.id)).toEqual([
    { input: "first", ref: "ts1" },
    { input: "second", ref: "ts2" },
  ]);
  expect(dequeueAllFollowUps(db, s.id)).toEqual([]);
});
