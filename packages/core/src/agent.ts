import { z } from "zod";

/**
 * A configured AI worker: prompt + model, plus building blocks attached *by reference* —
 * built-in tools and skills (instructions). Subagents are deferred.
 */
export const AgentConfig = z.object({
  /** Stable id; also the handle used to address the agent. */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Model that drives the loop, e.g. "claude-sonnet-4-5". */
  model: z.string().min(1),
  /** Role, scope, and style — not the task (the task arrives at invocation time). */
  systemPrompt: z.string().min(1),
  /**
   * High-level Gilly tool abstractions this agent may use: "Read", "Write", "Bash". The harness
   * maps these to the concrete SDK tools (e.g. Read → Read/Glob/Grep), so vendor tool names never
   * surface to users. Omitted or empty → chat-only (no filesystem/shell). Granting any tool
   * (or a skill) gives the agent a per-session workspace; see the harness loop.
   */
  tools: z.array(z.string()).optional(),
  /** Skill names this agent loads (folders in the skill registry). */
  skills: z.array(z.string()).optional(),
  /** Connector names this agent may discover; user grants are checked when a tool is invoked. */
  connectors: z.array(z.string()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfig>;
