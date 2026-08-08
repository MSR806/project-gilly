import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createDb,
  getAgent,
  getHarness,
  getLegacyAgentConnectors,
  listAgents,
  schema,
  updateHarness,
} from "@gilly/db";
import { loadAgents, loadSkills, syncAgents } from "./config.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const agent = {
  id: "echo",
  name: "Echo",
  harness: { id: "claude", config: { model: "claude-sonnet-4-5" } },
  systemPrompt: "Be terse.",
};

test("loadAgents reads and keys configs by id", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(join(dir, "echo.json"), JSON.stringify(agent));
  const agents = loadAgents(dir);
  expect(agents.get("echo")).toEqual(agent);
});

test("loadAgents throws on invalid config", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ id: "x" }));
  expect(() => loadAgents(dir)).toThrow();
});

test("legacy flat model configs normalize in memory and custom models remain loadable", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(
    join(dir, "legacy.json"),
    JSON.stringify({ id: "legacy", name: "Legacy", model: "private-model", systemPrompt: "x" }),
  );
  expect(loadAgents(dir).get("legacy")?.harness).toEqual({
    id: "claude",
    config: { model: "private-model" },
  });
  const db = createDb(":memory:");
  syncAgents(db, dir);
  expect(getAgent(db, "legacy")?.harness.config.model).toBe("private-model");

  const claude = getHarness(db, "claude");
  updateHarness(db, "claude", {
    ...(claude as NonNullable<typeof claude>),
    models: claude?.models.filter(({ id }) => id !== "private-model") ?? [],
  });
  syncAgents(db, dir);
  expect(getHarness(db, "claude")?.models.some(({ id }) => id === "private-model")).toBe(false);
});

test("loadSkills bundles a folder's files; requires SKILL.md", () => {
  const dir = tmp("gilly-skills-");
  const skill = join(dir, "cut-release");
  mkdirSync(join(skill, "ref"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Cut a release");
  writeFileSync(join(skill, "ref", "notes.md"), "details");
  const bundle = loadSkills(dir).get("cut-release");
  expect(bundle?.name).toBe("cut-release");
  expect(new Set(bundle?.files.map((f) => f.path))).toEqual(new Set(["SKILL.md", "ref/notes.md"]));

  const bad = tmp("gilly-skills-");
  mkdirSync(join(bad, "broken"));
  writeFileSync(join(bad, "broken", "readme.md"), "no skill file");
  expect(() => loadSkills(bad)).toThrow(/SKILL.md/);
});

test("syncAgents upserts config on every boot: new files added, existing overwritten", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(join(dir, "echo.json"), JSON.stringify(agent));
  const db = createDb(":memory:");

  syncAgents(db, dir);
  expect(listAgents(db).map((a) => a.id)).toEqual(["echo"]);

  // A newly shipped config file is imported; an edited one overwrites the DB row.
  writeFileSync(join(dir, "extra.json"), JSON.stringify({ ...agent, id: "extra" }));
  writeFileSync(join(dir, "echo.json"), JSON.stringify({ ...agent, name: "Echo v2" }));
  syncAgents(db, dir);
  expect(
    listAgents(db)
      .map((a) => a.id)
      .sort(),
  ).toEqual(["echo", "extra"]);
  expect(getAgent(db, "echo")?.name).toBe("Echo v2");
});

test("syncAgents leaves DB-only agents (no config file) untouched", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(join(dir, "echo.json"), JSON.stringify(agent));
  const db = createDb(":memory:");
  syncAgents(db, dir);

  // An agent created via the UI — present in the DB, absent from config — must survive a resync.
  createAgent(db, { ...agent, id: "ui-made" });
  syncAgents(db, dir);
  expect(
    listAgents(db)
      .map((a) => a.id)
      .sort(),
  ).toEqual(["echo", "ui-made"]);
});

test("syncAgents keeps booting after a file-backed harness becomes unavailable", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(join(dir, "echo.json"), JSON.stringify(agent));
  const db = createDb(":memory:");
  syncAgents(db, dir);

  const claude = getHarness(db, "claude");
  updateHarness(db, "claude", { ...(claude as NonNullable<typeof claude>), enabled: false });
  expect(() => syncAgents(db, dir)).not.toThrow();
  expect(getAgent(db, "echo")).toEqual(agent);
});

test("syncAgents preserves legacy connectors until they can migrate", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(join(dir, "echo.json"), JSON.stringify({ ...agent, connectors: ["echo"] }));
  const db = createDb(":memory:");
  db.insert(schema.agents)
    .values({
      id: agent.id,
      name: agent.name,
      model: agent.harness.config.model,
      harnessId: agent.harness.id,
      systemPrompt: agent.systemPrompt,
      gatewayTools: null,
      connectors: JSON.stringify(["echo"]),
      createdAt: 1,
    })
    .run();

  syncAgents(db, dir);

  expect(getLegacyAgentConnectors(db, "echo")).toEqual(["echo"]);
});
