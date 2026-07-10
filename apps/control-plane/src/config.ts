import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AgentConfig } from "@gilly/core";
import { createAgent, type Db, getAgent, updateAgent } from "@gilly/db";
import type { SkillBundle } from "@gilly/harness-protocol";
import { Glob } from "bun";

/** Load every `*.json` agent config in `dir`, keyed by id. Throws on invalid or empty. */
export function loadAgents(dir: string): Map<string, AgentConfig> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const agents = new Map<string, AgentConfig>();
  for (const file of files) {
    const path = join(dir, file);
    let agent: AgentConfig;
    try {
      agent = AgentConfig.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (e) {
      throw new Error(`Invalid agent config ${path}: ${e}`);
    }
    agents.set(agent.id, agent);
  }
  if (agents.size === 0) throw new Error(`No agent configs found in ${dir}`);
  return agents;
}

/**
 * Load every skill folder under `dir` (each holding a `SKILL.md` + supporting files), keyed by
 * folder name. Each becomes a {@link SkillBundle} whose files travel inline in the invocation.
 * Empty if `dir` is absent.
 */
export function loadSkills(dir: string): Map<string, SkillBundle> {
  const skills = new Map<string, SkillBundle>();
  if (!existsSync(dir)) return skills;
  for (const name of readdirSync(dir)) {
    const folder = join(dir, name);
    if (!statSync(folder).isDirectory()) continue;
    const files = [...new Glob("**/*").scanSync({ cwd: folder, onlyFiles: true })].map((rel) => ({
      // Normalize to forward-slash relative paths so the harness rebuilds the tree faithfully.
      path: rel.split(/[\\/]/).join("/"),
      contents: readFileSync(join(folder, rel), "utf8"),
    }));
    if (!files.some((f) => f.path === "SKILL.md")) {
      throw new Error(`Skill "${name}" is missing SKILL.md (${folder})`);
    }
    skills.set(name, { name, files });
  }
  return skills;
}

/**
 * Sync the on-disk `config/agents/*.json` into the DB on every boot: each config agent is upserted
 * (created if new, otherwise overwritten), so editing a config file or shipping a new default (e.g.
 * agent-builder) takes effect on restart. Agents that live only in the DB — created via the UI or
 * the agent-builder — are untouched, but a DB edit to an agent that *also* has a config file is
 * overwritten by the file. `config/agents` is the source of truth for whatever it contains. Skills
 * need no seed; the LocalSkillStore loads them from disk each boot.
 */
export function syncAgents(db: Db, agentsDir: string): void {
  for (const agent of loadAgents(agentsDir).values()) {
    if (getAgent(db, agent.id)) updateAgent(db, agent.id, agent);
    else createAgent(db, agent);
  }
}
