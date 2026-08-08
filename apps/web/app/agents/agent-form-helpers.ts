import { AgentConfig, HarnessDefinition as HarnessDefinitionSchema } from "@gilly/core";

export type AgentValues = ReturnType<typeof AgentConfig.parse>;
export type HarnessDefinition = ReturnType<typeof HarnessDefinitionSchema.parse>;

/** Validate the registry returned by the control plane. */
export function parseHarnessRegistry(value: unknown): HarnessDefinition[] {
  const parsed = HarnessDefinitionSchema.array().safeParse(value);
  if (!parsed.success) throw new Error("Invalid harness registry");
  return parsed.data;
}

export type GatewayTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
  source: "custom" | "composio";
  toolkit: string;
  connected: boolean;
};

export type GatewayToolGroup = {
  label: string;
  options: { value: string; description?: string }[];
};

/** Resolve the selected enabled harness and whether its current model is offered. */
export function harnessSelection(
  harnesses: readonly HarnessDefinition[],
  harness: AgentValues["harness"],
) {
  const enabled = harnesses.filter((candidate) => candidate.enabled);
  const selected = enabled.find((candidate) => candidate.id === harness.id);
  const modelValid = selected?.models.some((model) => model.id === harness.config.model) ?? false;
  return { enabled, selected, modelValid, valid: !!selected && modelValid };
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

/** Group concrete tools by toolkit and keep selected tools missing from the current catalog. */
export function gatewayToolGroups(
  tools: readonly GatewayTool[],
  selected: readonly string[],
): GatewayToolGroup[] {
  const groups = new Map<string, GatewayToolGroup["options"]>();

  for (const tool of tools) {
    const options = groups.get(tool.toolkit) ?? [];
    options.push({
      value: tool.name,
      description: tool.connected ? tool.description : `${tool.description} (not connected)`,
    });
    groups.set(tool.toolkit, options);
  }

  const available = new Set(tools.map((tool) => tool.name));
  const unavailable = [...new Set(selected)]
    .filter((name) => !available.has(name))
    .map((value) => ({ value, description: "Unavailable in the current catalog" }));

  return [
    ...[...groups.entries()].map(([label, options]) => ({ label, options })),
    ...(unavailable.length ? [{ label: "Unavailable", options: unavailable }] : []),
  ];
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
