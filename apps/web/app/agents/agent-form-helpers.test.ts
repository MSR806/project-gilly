import { expect, test } from "bun:test";
import {
  gatewayToolGroups,
  harnessSelection,
  parseAgentValues,
  parseGatewayTools,
  parseHarnessRegistry,
} from "./agent-form-helpers";

const registry = [
  {
    id: "claude",
    name: "Claude",
    image: "/harnesses/claude.svg",
    enabled: true,
    models: [{ id: "sonnet", name: "Sonnet" }],
  },
  {
    id: "codex",
    name: "Codex",
    image: "/harnesses/codex.svg",
    enabled: false,
    models: [{ id: "gpt", name: "GPT" }],
  },
];

test("parseHarnessRegistry validates registry entries", () => {
  expect(parseHarnessRegistry(registry)).toEqual(registry);
  expect(() => parseHarnessRegistry([{ id: "claude" }])).toThrow("Invalid harness registry");
});

test("harnessSelection exposes only enabled harnesses and requires an offered model", () => {
  expect(harnessSelection(registry, { id: "claude", config: { model: "sonnet" } })).toEqual({
    enabled: [registry[0]],
    selected: registry[0],
    modelValid: true,
    valid: true,
  });
  expect(harnessSelection(registry, { id: "codex", config: { model: "gpt" } }).valid).toBe(false);
  expect(harnessSelection(registry, { id: "claude", config: { model: "legacy" } }).valid).toBe(
    false,
  );
});

test("parseAgentValues accepts nested harness config and rejects flat model responses", () => {
  const agent = {
    id: "helper",
    name: "Server name",
    harness: { id: "claude", config: { model: "sonnet" } },
    systemPrompt: "Help.",
    skills: ["research"],
    gatewayTools: ["GITHUB_CREATE_ISSUE"],
  };
  expect(parseAgentValues(agent)).toEqual(agent);
  expect(() => parseAgentValues({ ...agent, harness: undefined, model: "sonnet" })).toThrow(
    "Server returned an invalid agent",
  );
});

test("parseGatewayTools validates and unwraps the tool catalog", () => {
  const tools = [
    {
      name: "GITHUB_CREATE_ISSUE",
      description: "Create an issue",
      source: "composio" as const,
      toolkit: "github",
      connected: true,
    },
  ];

  expect(parseGatewayTools({ tools })).toEqual(tools);
  expect(() => parseGatewayTools({ tools: [{ ...tools[0], connected: "yes" }] })).toThrow(
    "Invalid tool catalog",
  );
});

test("gatewayToolGroups groups by toolkit and preserves selected unavailable tools", () => {
  expect(
    gatewayToolGroups(
      [
        {
          name: "GITHUB_CREATE_ISSUE",
          description: "Create an issue",
          source: "composio",
          toolkit: "github",
          connected: true,
        },
        {
          name: "custom_search",
          description: "Search records",
          source: "custom",
          toolkit: "internal",
          connected: false,
        },
      ],
      ["GITHUB_CREATE_ISSUE", "retired_tool"],
    ),
  ).toEqual([
    {
      label: "github",
      options: [{ value: "GITHUB_CREATE_ISSUE", description: "Create an issue" }],
    },
    {
      label: "internal",
      options: [{ value: "custom_search", description: "Search records (not connected)" }],
    },
    {
      label: "Unavailable",
      options: [{ value: "retired_tool", description: "Unavailable in the current catalog" }],
    },
  ]);
});
