import { expect, test } from "bun:test";
import { createDb } from "./client.ts";
import {
  completeRun,
  createRun,
  dequeueAllFollowUps,
  dequeueFollowUp,
  enqueueFollowUp,
  getAgentSkillNames,
  getOrCreateSession,
  hasActiveRun,
  listAgentRows,
  listSkillRows,
  loadAgentConfigsFromDb,
  loadSkillBundlesFromDb,
  replaceAgentSkillLinks,
  seedRegistryFromConfig,
  upsertAgentConfig,
  upsertSkillBundle,
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

// ─── Registry: Agents ──────────────────────────────────────────────────────

test("upsertAgentConfig inserts and updates agent rows", () => {
  const db = freshDb();
  upsertAgentConfig(db, {
    id: "test-agent",
    name: "Test Agent",
    model: "sonnet",
    systemPrompt: "You are a test agent.",
    tools: ["Read", "Write"],
  });
  const rows = listAgentRows(db);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.id).toBe("test-agent");
  expect(row?.name).toBe("Test Agent");
  expect(JSON.parse(row?.toolsJson ?? "[]")).toEqual(["Read", "Write"]);

  // Update
  upsertAgentConfig(db, {
    id: "test-agent",
    name: "Updated Agent",
    model: "opus",
    systemPrompt: "Updated prompt.",
  });
  const updated = listAgentRows(db);
  expect(updated).toHaveLength(1);
  expect(updated[0]?.name).toBe("Updated Agent");
  expect(updated[0]?.model).toBe("opus");
  expect(updated[0]?.toolsJson).toBeNull();
});

// ─── Registry: Skills ──────────────────────────────────────────────────────

test("upsertSkillBundle inserts and updates skill rows", () => {
  const db = freshDb();
  upsertSkillBundle(db, {
    name: "my-skill",
    files: [{ path: "SKILL.md", contents: "# My Skill\nDo stuff." }],
  });
  const rows = listSkillRows(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.name).toBe("my-skill");
  const files = JSON.parse(rows[0]?.filesJson ?? "[]");
  expect(files).toEqual([{ path: "SKILL.md", contents: "# My Skill\nDo stuff." }]);

  // Update
  upsertSkillBundle(db, {
    name: "my-skill",
    files: [{ path: "SKILL.md", contents: "# Updated" }],
  });
  const updated = listSkillRows(db);
  expect(updated).toHaveLength(1);
  expect(JSON.parse(updated[0]?.filesJson ?? "[]")).toEqual([
    { path: "SKILL.md", contents: "# Updated" },
  ]);
});

// ─── Registry: Agent-Skill links ──────────────────────────────────────────

test("replaceAgentSkillLinks manages many-to-many links", () => {
  const db = freshDb();
  upsertAgentConfig(db, {
    id: "a1",
    name: "A1",
    model: "sonnet",
    systemPrompt: "prompt",
  });
  upsertSkillBundle(db, { name: "s1", files: [{ path: "SKILL.md", contents: "s1" }] });
  upsertSkillBundle(db, { name: "s2", files: [{ path: "SKILL.md", contents: "s2" }] });

  replaceAgentSkillLinks(db, "a1", ["s1", "s2"]);
  expect(getAgentSkillNames(db, "a1")).toEqual(["s1", "s2"]);

  // Replace with different set
  replaceAgentSkillLinks(db, "a1", ["s2"]);
  expect(getAgentSkillNames(db, "a1")).toEqual(["s2"]);

  // Clear all
  replaceAgentSkillLinks(db, "a1", []);
  expect(getAgentSkillNames(db, "a1")).toEqual([]);
});

// ─── Registry: Loaders ────────────────────────────────────────────────────

test("loadAgentConfigsFromDb round-trips agent configs with skills", () => {
  const db = freshDb();
  upsertAgentConfig(db, {
    id: "coder",
    name: "Coder",
    model: "sonnet",
    systemPrompt: "Code stuff.",
    tools: ["Read", "Write"],
  });
  upsertSkillBundle(db, { name: "our-repos", files: [{ path: "SKILL.md", contents: "repos" }] });
  replaceAgentSkillLinks(db, "coder", ["our-repos"]);

  const map = loadAgentConfigsFromDb(db);
  expect(map.size).toBe(1);
  const agent = map.get("coder");
  expect(agent).toBeDefined();
  expect(agent?.name).toBe("Coder");
  expect(agent?.tools).toEqual(["Read", "Write"]);
  expect(agent?.skills).toEqual(["our-repos"]);
});

test("loadSkillBundlesFromDb round-trips skill bundles", () => {
  const db = freshDb();
  upsertSkillBundle(db, {
    name: "test-skill",
    files: [
      { path: "SKILL.md", contents: "# Test" },
      { path: "extra.txt", contents: "bonus" },
    ],
  });
  const map = loadSkillBundlesFromDb(db);
  expect(map.size).toBe(1);
  const bundle = map.get("test-skill");
  expect(bundle).toBeDefined();
  expect(bundle?.name).toBe("test-skill");
  expect(bundle?.files).toHaveLength(2);
  expect(bundle?.files[0]?.path).toBe("SKILL.md");
});

// ─── Registry: Seeding ────────────────────────────────────────────────────

test("seedRegistryFromConfig inserts file configs only when missing", () => {
  const db = freshDb();
  const fileAgents = new Map([
    [
      "echo",
      {
        id: "echo",
        name: "Echo",
        model: "sonnet",
        systemPrompt: "Echo back.",
        skills: ["our-repos"],
      },
    ],
  ]);
  const fileSkills = new Map([
    ["our-repos", { name: "our-repos", files: [{ path: "SKILL.md", contents: "repos" }] }],
  ]);

  seedRegistryFromConfig(db, fileAgents, fileSkills);
  expect(loadAgentConfigsFromDb(db).size).toBe(1);
  expect(loadSkillBundlesFromDb(db).size).toBe(1);
  expect(loadAgentConfigsFromDb(db).get("echo")?.skills).toEqual(["our-repos"]);

  // Seeding again does NOT overwrite existing
  const updatedAgents = new Map([
    ["echo", { id: "echo", name: "OVERWRITTEN", model: "opus", systemPrompt: "new" }],
  ]);
  seedRegistryFromConfig(db, updatedAgents, fileSkills);
  expect(loadAgentConfigsFromDb(db).get("echo")?.name).toBe("Echo");
});
