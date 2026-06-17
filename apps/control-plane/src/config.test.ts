import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgents } from "./config.ts";

const agent = { id: "echo", name: "Echo", model: "claude-sonnet-4-5", systemPrompt: "Be terse." };

test("loadAgents reads and keys configs by id", () => {
  const dir = mkdtempSync(join(tmpdir(), "gilly-agents-"));
  writeFileSync(join(dir, "echo.json"), JSON.stringify(agent));
  const agents = loadAgents(dir);
  expect(agents.get("echo")).toEqual(agent);
});

test("loadAgents throws on invalid config", () => {
  const dir = mkdtempSync(join(tmpdir(), "gilly-agents-"));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ id: "x" }));
  expect(() => loadAgents(dir)).toThrow();
});
