import { expect, test } from "bun:test";
import type { AgentConfig } from "@gilly/core";
import { createDb } from "./client.ts";
import {
  completeRun,
  createAgent,
  createRun,
  deleteAgent,
  dequeueAllFollowUps,
  dequeueFollowUp,
  enqueueFollowUp,
  getAgent,
  getOrCreateSession,
  hasActiveRun,
  listAgents,
  updateAgent,
} from "./repo.ts";

const freshDb = () => createDb(":memory:");
const seed = { agentId: "a", source: "slack", sourceKey: "C1:1.0" };
const agentCfg: AgentConfig = {
  id: "coder",
  name: "Coder",
  model: "claude-sonnet-4-5",
  systemPrompt: "Write code.",
  tools: ["Read", "Bash"],
  skills: ["our-repos"],
};

test("agent round-trips through the DB with tools/skills arrays intact", () => {
  const db = freshDb();
  createAgent(db, agentCfg);
  expect(getAgent(db, "coder")).toEqual(agentCfg);
});

test("chat-only agent (no tools/skills) round-trips without the optional fields", () => {
  const db = freshDb();
  const chat: AgentConfig = { id: "echo", name: "Echo", model: "m", systemPrompt: "Hi." };
  createAgent(db, chat);
  expect(getAgent(db, "echo")).toEqual(chat);
});

test("createAgent rejects a duplicate id", () => {
  const db = freshDb();
  createAgent(db, agentCfg);
  expect(() => createAgent(db, agentCfg)).toThrow(/already exists/);
});

test("listAgents returns agents oldest-first", () => {
  const db = freshDb();
  createAgent(db, { id: "a", name: "A", model: "m", systemPrompt: "x" });
  createAgent(db, { id: "b", name: "B", model: "m", systemPrompt: "x" });
  expect(listAgents(db).map((a) => a.id)).toEqual(["a", "b"]);
});

test("updateAgent replaces config; deleteAgent removes it", () => {
  const db = freshDb();
  createAgent(db, agentCfg);
  updateAgent(db, "coder", { ...agentCfg, name: "Coder 2", skills: undefined });
  const updated = getAgent(db, "coder");
  expect(updated?.name).toBe("Coder 2");
  expect(updated?.skills).toBeUndefined();
  expect(() => updateAgent(db, "ghost", agentCfg)).toThrow(/not found/);
  deleteAgent(db, "coder");
  expect(getAgent(db, "coder")).toBeUndefined();
});

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
