import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentConfig } from "@gilly/core";

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
