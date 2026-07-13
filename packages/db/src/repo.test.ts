import { expect, test } from "bun:test";
import type { AgentConfig, SlackConnection } from "@gilly/core";
import { createDb } from "./client.ts";
import {
  addGrant,
  appendRunStep,
  completeRun,
  createAgent,
  createGatewayToken,
  createRun,
  createSlackConnection,
  deleteAgent,
  deleteGatewayTokensForRun,
  deleteGrant,
  deleteSlackConnection,
  dequeueAllFollowUps,
  enqueueFollowUp,
  failRunningRunsBySource,
  getAgent,
  getCredential,
  getGatewayToken,
  getOrCreateSession,
  getRun,
  getSlackConnection,
  hasActiveRun,
  listAgents,
  listGrants,
  listRunSteps,
  listSlackConnections,
  setCredential,
  setSlackConnectionStatus,
  updateAgent,
  updateSlackConnection,
  upsertUserBySlackId,
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

test("run lookup and source recovery fail only unfinished runs from that source", () => {
  const db = freshDb();
  const gateway = getOrCreateSession(db, {
    agentId: "a",
    source: "gateway",
    sourceKey: "gateway:1",
  });
  const web = getOrCreateSession(db, { agentId: "a", source: "web", sourceKey: "web:1" });
  const abandoned = createRun(db, gateway.id, "background");
  const completed = createRun(db, gateway.id, "done");
  const untouched = createRun(db, web.id, "chat");
  completeRun(db, completed.id, "ok");

  expect(failRunningRunsBySource(db, "gateway", "restarted")).toBe(1);
  expect(getRun(db, abandoned.id)).toMatchObject({ status: "error", error: "restarted" });
  expect(getRun(db, completed.id)).toMatchObject({ status: "completed", output: "ok" });
  expect(getRun(db, untouched.id)?.status).toBe("running");
});

test("run steps are validated, ordered, and isolated by run", () => {
  const db = freshDb();
  const session = getOrCreateSession(db, seed);
  const first = createRun(db, session.id, "first");
  const second = createRun(db, session.id, "second");

  appendRunStep(db, first.id, { type: "message", text: "Working" });
  appendRunStep(db, second.id, { type: "error", error: "boom" });
  appendRunStep(db, first.id, { type: "tool", name: "Read", summary: "README.md" });

  expect(listRunSteps(db, first.id)).toEqual([
    { type: "message", text: "Working" },
    { type: "tool", name: "Read", summary: "README.md" },
  ]);
  expect(listRunSteps(db, second.id)).toEqual([{ type: "error", error: "boom" }]);
  expect(() => appendRunStep(db, first.id, { type: "unknown" } as never)).toThrow();
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

test("upsertUserBySlackId inserts then updates the same row on second call", () => {
  const db = freshDb();
  const first = upsertUserBySlackId(db, { slackUserId: "U1", name: "Ada" });
  const second = upsertUserBySlackId(db, { slackUserId: "U1", name: "Ada Lovelace" });
  expect(second.id).toBe(first.id);
  expect(second.name).toBe("Ada Lovelace");
  expect(second.isAdmin).toBe(false);
});

test("addGrant/listGrants/deleteGrant round-trip", () => {
  const db = freshDb();
  const user = upsertUserBySlackId(db, { slackUserId: "U1", name: "Ada" });
  const g1 = addGrant(db, user.id, "gmail.*");
  addGrant(db, user.id, "branch.query");
  expect(
    listGrants(db, user.id)
      .map((g) => g.toolPattern)
      .sort(),
  ).toEqual(["branch.query", "gmail.*"]);
  deleteGrant(db, g1.id);
  expect(listGrants(db, user.id).map((g) => g.toolPattern)).toEqual(["branch.query"]);
});

test("setCredential upserts on (provider, key); getCredential returns rows", () => {
  const db = freshDb();
  setCredential(db, "gmail", "token", "v1");
  setCredential(db, "gmail", "token", "v2");
  setCredential(db, "gmail", "refresh", "r1");
  expect(getCredential(db, "gmail")).toEqual(
    expect.arrayContaining([
      { key: "token", value: "v2" },
      { key: "refresh", value: "r1" },
    ]),
  );
  expect(getCredential(db, "gmail")).toHaveLength(2);
});

test("createGatewayToken → getGatewayToken → deleteGatewayTokensForRun", () => {
  const db = freshDb();
  const token = createGatewayToken(db, {
    runId: "run1",
    userId: "u1",
    agentId: "a1",
    grants: ["gmail.*", "branch.query"],
    ttlMs: 60_000,
  });
  const row = getGatewayToken(db, token);
  expect(row?.runId).toBe("run1");
  expect(row?.grants).toEqual(["gmail.*", "branch.query"]);
  deleteGatewayTokensForRun(db, "run1");
  expect(getGatewayToken(db, token)).toBeUndefined();
});

test("agent with connectors round-trips through get/update", () => {
  const db = freshDb();
  createAgent(db, { ...agentCfg, connectors: ["branch"] });
  expect(getAgent(db, "coder")?.connectors).toEqual(["branch"]);
  updateAgent(db, "coder", { ...agentCfg, connectors: ["branch", "gmail"] });
  expect(getAgent(db, "coder")?.connectors).toEqual(["branch", "gmail"]);
});

// --- Slack connections -------------------------------------------------------

const conn: SlackConnection = {
  id: "conn-1",
  name: "Acme",
  agentId: "coder",
  botToken: "enc-bot",
  appToken: "enc-app",
  teamId: "T1",
  teamName: "Acme Inc",
  status: "active",
  createdAt: 1,
};

test("slack connection round-trips through the DB", () => {
  const db = freshDb();
  createSlackConnection(db, conn);
  expect(getSlackConnection(db, "conn-1")).toEqual(conn);
  expect(listSlackConnections(db)).toEqual([conn]);
});

test("createSlackConnection rejects a duplicate id", () => {
  const db = freshDb();
  createSlackConnection(db, conn);
  expect(() => createSlackConnection(db, conn)).toThrow(/already exists/);
});

test("updateSlackConnection writes only the keys present in the patch", () => {
  const db = freshDb();
  createSlackConnection(db, conn);
  // Rebind the agent and rename; leave tokens untouched (blank-on-edit case).
  const updated = updateSlackConnection(db, "conn-1", { name: "Renamed", agentId: "other" });
  expect(updated.name).toBe("Renamed");
  expect(updated.agentId).toBe("other");
  expect(updated.botToken).toBe("enc-bot"); // unchanged
  expect(updated.appToken).toBe("enc-app"); // unchanged
});

test("setSlackConnectionStatus records an error and clears it again", () => {
  const db = freshDb();
  createSlackConnection(db, conn);
  setSlackConnectionStatus(db, "conn-1", "error", "bad token");
  expect(getSlackConnection(db, "conn-1")).toMatchObject({
    status: "error",
    lastError: "bad token",
  });
  setSlackConnectionStatus(db, "conn-1", "active");
  expect(getSlackConnection(db, "conn-1")).toMatchObject({
    status: "active",
    lastError: undefined,
  });
});

test("deleteSlackConnection removes the row", () => {
  const db = freshDb();
  createSlackConnection(db, conn);
  deleteSlackConnection(db, "conn-1");
  expect(getSlackConnection(db, "conn-1")).toBeUndefined();
});
