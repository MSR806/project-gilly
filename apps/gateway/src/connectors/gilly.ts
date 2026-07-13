import { AgentConfig } from "@gilly/core";
import { defineConnector, defineTool } from "@gilly/gateway-kit";
import { z } from "zod";

const cpUrl = () => process.env.GILLY_CONTROL_PLANE_URL ?? "http://localhost:4000";

async function cp(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${cpUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: "control_plane_error", status: res.status, body };
  return body;
}

const agentPatch = AgentConfig.omit({ id: true }).partial();
const skillInput = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1),
  files: z
    .array(z.object({ path: z.string().min(1), contents: z.string() }))
    .optional()
    .describe("Supporting files bundled with the skill (e.g. scripts it runs); exclude SKILL.md."),
});
const skillPatch = skillInput.omit({ name: true }).partial();

export const gilly = defineConnector({
  name: "gilly",
  auth: { kind: "none" },
  tools: [
    defineTool({
      name: "gilly.list_agents",
      description: "List Gilly agents with id, name, and model.",
      input: z.object({}),
      handler: async () => cp("/api/agents"),
    }),
    defineTool({
      name: "gilly.get_agent",
      description: "Get one Gilly agent config by id.",
      input: z.object({ id: z.string().min(1) }),
      handler: async ({ id }) => cp(`/api/agents/${encodeURIComponent(id)}`),
    }),
    defineTool({
      name: "gilly.create_agent",
      description:
        "Create a Gilly agent. Input is AgentConfig: id, name, model, systemPrompt, optional tools, skills, connectors.",
      input: AgentConfig,
      handler: async (agent) => cp("/api/agents", { method: "POST", body: JSON.stringify(agent) }),
    }),
    defineTool({
      name: "gilly.update_agent",
      description:
        "Patch a Gilly agent by id. Provide only fields to change: name, model, systemPrompt, tools, skills, connectors.",
      input: z.object({ id: z.string().min(1), patch: agentPatch }),
      handler: async ({ id, patch }) => {
        const current = await cp(`/api/agents/${encodeURIComponent(id)}`);
        if (current && typeof current === "object" && "error" in current) return current;
        return cp(`/api/agents/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ ...(current as object), ...patch, id }),
        });
      },
    }),
    defineTool({
      name: "gilly.start_agent",
      description:
        "Start a Gilly agent in the background. Returns a runId immediately; check it with gilly.get_run.",
      input: z.object({ id: z.string().min(1), message: z.string().min(1) }),
      handler: async ({ id, message }) =>
        cp(`/api/agents/${encodeURIComponent(id)}/runs`, {
          method: "POST",
          body: JSON.stringify({ message }),
        }),
    }),
    defineTool({
      name: "gilly.get_run",
      description:
        "Get a background agent run's status and accumulated message/tool/error steps, plus final output or runError.",
      input: z.object({ runId: z.string().min(1) }),
      handler: async ({ runId }) => cp(`/api/runs/${encodeURIComponent(runId)}`),
    }),
    defineTool({
      name: "gilly.list_skills",
      description: "List Gilly skills with name and description.",
      input: z.object({}),
      handler: async () => cp("/api/skills"),
    }),
    defineTool({
      name: "gilly.get_skill",
      description: "Get one Gilly skill by name, including content.",
      input: z.object({ name: z.string().min(1) }),
      handler: async ({ name }) => cp(`/api/skills/${encodeURIComponent(name)}`),
    }),
    defineTool({
      name: "gilly.create_skill",
      description:
        "Create a Gilly skill. Input: name, description, content (SKILL.md body), optional files[] (supporting scripts the skill runs, bundled next to SKILL.md).",
      input: skillInput,
      handler: async (skill) => cp("/api/skills", { method: "POST", body: JSON.stringify(skill) }),
    }),
    defineTool({
      name: "gilly.update_skill",
      description:
        "Patch a Gilly skill by name. Provide only the fields to change: description, content, and/or files[] (replaces the full supporting-file set).",
      input: z.object({ name: z.string().min(1), patch: skillPatch }),
      handler: async ({ name, patch }) => {
        const current = await cp(`/api/skills/${encodeURIComponent(name)}`);
        if (current && typeof current === "object" && "error" in current) return current;
        return cp(`/api/skills/${encodeURIComponent(name)}`, {
          method: "PUT",
          body: JSON.stringify({ ...(current as object), ...patch, name }),
        });
      },
    }),
  ],
});
