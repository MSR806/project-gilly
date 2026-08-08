import { z } from "zod";
import { AgentHarness } from "./harness.ts";

/**
 * A configured AI worker: prompt + model, plus building blocks attached *by reference* —
 * built-in tools and skills (instructions). Subagents are deferred.
 */
export const AgentConfig = z.object({
  /** Stable id; also the handle used to address the agent. */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Explicit harness selection and that harness's configuration. */
  harness: AgentHarness,
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
  /** Exact canonical gateway tool names this agent may discover and invoke. */
  gatewayTools: z.array(z.string()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfig>;
