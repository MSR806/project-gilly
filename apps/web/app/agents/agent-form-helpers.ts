import { AgentConfig, ModelInfo as ModelInfoSchema } from "@gilly/core";

export type AgentValues = ReturnType<typeof AgentConfig.parse>;
export type ModelInfo = ReturnType<typeof ModelInfoSchema.parse>;

export type GatewayTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
  source: "custom" | "composio";
  toolkit: string;
  connected: boolean;
};

export type ModelOptionGroup = {
  label: string;
  options: { value: string; label: string }[];
};

export type GatewayToolkit = {
  id: string;
  source: GatewayTool["source"];
  toolkit: string;
  connected: boolean;
  tools: GatewayTool[];
};

const PROVIDERS = [
  { provider: "anthropic", label: "Anthropic" },
  { provider: "openai", label: "OpenAI" },
] as const;

/** Validate the model catalog returned by the control plane. */
export function parseModelCatalog(value: unknown): ModelInfo[] {
  const parsed = ModelInfoSchema.array().safeParse(value);
  if (!parsed.success) throw new Error("Invalid model catalog");
  return parsed.data;
}

/** Group catalog models in picker order, preserving an unlisted current model as a safe fallback. */
export function modelOptionGroups(models: readonly ModelInfo[], currentModel: string) {
  const groups: ModelOptionGroup[] = PROVIDERS.map(({ provider, label }) => ({
    label,
    options: models
      .filter((model) => model.provider === provider)
      .map((model) => ({ value: model.id, label: model.label })),
  })).filter((group) => group.options.length > 0);
  const currentIsCatalogued = models.some((model) => model.id === currentModel);

  if (currentModel && !currentIsCatalogued) {
    groups.unshift({
      label: "Current / legacy",
      options: [{ value: currentModel, label: `${currentModel} (current model)` }],
    });
  }

  return { groups, currentIsCatalogued };
}

/** Validate and unwrap the concrete gateway tool catalog. */
export function parseGatewayTools(value: unknown): GatewayTool[] {
  if (!isRecord(value) || !Array.isArray(value.tools)) throw new Error("Invalid tool catalog");

  return value.tools.map((tool) => {
    if (
      !isRecord(tool) ||
      typeof tool.name !== "string" ||
      typeof tool.description !== "string" ||
      (tool.source !== "custom" && tool.source !== "composio") ||
      typeof tool.toolkit !== "string" ||
      typeof tool.connected !== "boolean"
    ) {
      throw new Error("Invalid tool catalog");
    }

    return {
      name: tool.name,
      description: tool.description,
      ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
      source: tool.source,
      toolkit: tool.toolkit,
      connected: tool.connected,
    };
  });
}

/** Group exact gateway tools by provider and toolkit for toolkit-level selection. */
export function gatewayToolkits(tools: readonly GatewayTool[]): GatewayToolkit[] {
  const groups = new Map<string, GatewayToolkit>();
  for (const tool of tools) {
    const id = `${tool.source}:${tool.toolkit}`;
    const group = groups.get(id);
    if (group) {
      group.tools.push(tool);
      group.connected = group.connected && tool.connected;
    } else {
      groups.set(id, {
        id,
        source: tool.source,
        toolkit: tool.toolkit,
        connected: tool.connected,
        tools: [tool],
      });
    }
  }

  for (const group of groups.values()) group.tools.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups.values()].sort((a, b) => a.toolkit.localeCompare(b.toolkit));
}

/** Select all current tools in a toolkit, or clear them when already fully selected. */
export function toggleGatewayToolkit(
  selected: readonly string[],
  toolkitTools: readonly string[],
): string[] {
  const next = new Set(selected);
  const allSelected = toolkitTools.length > 0 && toolkitTools.every((tool) => next.has(tool));
  for (const tool of toolkitTools) {
    if (allSelected) next.delete(tool);
    else next.add(tool);
  }
  return [...next];
}

/** Collapse exact gateway tool names to catalog toolkits, with a prefix fallback for unavailable tools. */
export function gatewayToolkitNames(
  tools: readonly string[] = [],
  catalog: readonly GatewayTool[] = [],
): string[] {
  const toolkitByTool = new Map(catalog.map((tool) => [tool.name, tool.toolkit]));
  return [...new Set(tools.map((tool) => toolkitByTool.get(tool) ?? (tool.split(".")[0] || tool)))];
}

/** Validate the successful create/update response before reflecting server-owned values in the UI. */
export function parseAgentValues(value: unknown): AgentValues {
  const parsed = AgentConfig.safeParse(value);
  if (!parsed.success) throw new Error("Server returned an invalid agent");
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
