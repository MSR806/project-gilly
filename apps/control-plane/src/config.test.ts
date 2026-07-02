import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, listAgents } from "@gilly/db";
import { loadAgents, loadSkills, seedAgents } from "./config.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const agent = { id: "echo", name: "Echo", model: "claude-sonnet-4-5", systemPrompt: "Be terse." };

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

test("seedAgents imports config on an empty DB, then is a no-op", () => {
  const dir = tmp("gilly-agents-");
  writeFileSync(join(dir, "echo.json"), JSON.stringify(agent));
  const db = createDb(":memory:");

  seedAgents(db, dir);
  expect(listAgents(db).map((a) => a.id)).toEqual(["echo"]);

  // Second run does not re-import (no throw, count unchanged) even if files change.
  writeFileSync(join(dir, "extra.json"), JSON.stringify({ ...agent, id: "extra" }));
  seedAgents(db, dir);
  expect(listAgents(db).map((a) => a.id)).toEqual(["echo"]);
});

