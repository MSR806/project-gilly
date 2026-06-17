import { z } from "zod";

/** A configured AI worker. MVP: prompt + model only — no MCP, skills, or subagents. */
export const AgentConfig = z.object({
  /** Stable id; also the handle used to address the agent. */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Model that drives the loop, e.g. "claude-sonnet-4-5". */
  model: z.string().min(1),
  /** Role, scope, and style — not the task (the task arrives at invocation time). */
  systemPrompt: z.string().min(1),
});

export type AgentConfig = z.infer<typeof AgentConfig>;
