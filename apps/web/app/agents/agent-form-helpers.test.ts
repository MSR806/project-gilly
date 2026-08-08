import { expect, test } from "bun:test";
import {
  gatewayToolkitNames,
  gatewayToolkits,
  modelOptionGroups,
  parseAgentValues,
  parseGatewayTools,
  parseModelCatalog,
  toggleGatewayToolkit,
} from "./agent-form-helpers";

test("parseModelCatalog validates catalog entries", () => {
  expect(parseModelCatalog([{ id: "gpt", label: "GPT", provider: "openai" }])).toEqual([
    { id: "gpt", label: "GPT", provider: "openai" },
  ]);
  expect(() => parseModelCatalog([{ id: "gpt", provider: "openai" }])).toThrow(
    "Invalid model catalog",
  );
});

test("modelOptionGroups uses provider order and preserves an unlisted current model", () => {
  const result = modelOptionGroups(
    [
      { id: "claude", label: "Claude", provider: "anthropic" },
      { id: "gpt", label: "GPT", provider: "openai" },
    ],
    "retired-model",
  );

  expect(result).toEqual({
    currentIsCatalogued: false,
    groups: [
      {
        label: "Current / legacy",
        options: [{ value: "retired-model", label: "retired-model (current model)" }],
      },
      { label: "Anthropic", options: [{ value: "claude", label: "Claude" }] },
      { label: "OpenAI", options: [{ value: "gpt", label: "GPT" }] },
    ],
  });
});

test("modelOptionGroups does not duplicate a catalogued current model", () => {
  expect(
    modelOptionGroups([{ id: "claude", label: "Claude", provider: "anthropic" }], "claude"),
  ).toEqual({
    currentIsCatalogued: true,
    groups: [{ label: "Anthropic", options: [{ value: "claude", label: "Claude" }] }],
  });
});

test("parseAgentValues returns the server agent and rejects malformed responses", () => {
  const agent = {
    id: "helper",
    name: "Server name",
    model: "claude",
    systemPrompt: "Help.",
    skills: ["research"],
    gatewayTools: ["GITHUB_CREATE_ISSUE"],
  };

  expect(parseAgentValues(agent)).toEqual(agent);
  expect(() => parseAgentValues({ ...agent, model: undefined })).toThrow(
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

test("gatewayToolkits groups exact tools by source and toolkit", () => {
  expect(
    gatewayToolkits([
      {
        name: "github.create_issue",
        description: "Create an issue",
        source: "composio",
        toolkit: "github",
        connected: true,
      },
      {
        name: "github.get_issue",
        description: "Get an issue",
        source: "composio",
        toolkit: "github",
        connected: true,
      },
      {
        name: "internal.search",
        description: "Search records",
        source: "custom",
        toolkit: "internal",
        connected: false,
      },
    ]),
  ).toEqual([
    {
      id: "composio:github",
      source: "composio",
      toolkit: "github",
      connected: true,
      tools: [
        {
          name: "github.create_issue",
          description: "Create an issue",
          source: "composio",
          toolkit: "github",
          connected: true,
        },
        {
          name: "github.get_issue",
          description: "Get an issue",
          source: "composio",
          toolkit: "github",
          connected: true,
        },
      ],
    },
    {
      id: "custom:internal",
      source: "custom",
      toolkit: "internal",
      connected: false,
      tools: [
        {
          name: "internal.search",
          description: "Search records",
          source: "custom",
          toolkit: "internal",
          connected: false,
        },
      ],
    },
  ]);
});

test("toggleGatewayToolkit selects partial toolkits and clears complete ones without losing legacy values", () => {
  expect(
    toggleGatewayToolkit(
      ["github.create_issue", "legacy.tool"],
      ["github.create_issue", "github.get_issue"],
    ),
  ).toEqual(["github.create_issue", "legacy.tool", "github.get_issue"]);
  expect(
    toggleGatewayToolkit(
      ["github.create_issue", "legacy.tool", "github.get_issue"],
      ["github.create_issue", "github.get_issue"],
    ),
  ).toEqual(["legacy.tool"]);
});

test("gatewayToolkitNames shows one entry per exact-tool prefix", () => {
  expect(
    gatewayToolkitNames(["echo.ping", "gmail.send_email", "gmail.create_draft", "legacy_tool"]),
  ).toEqual(["echo", "gmail", "legacy_tool"]);
});

test("gatewayToolkitNames uses catalog metadata for underscore-formatted tools", () => {
  const catalog = [
    {
      name: "GITHUB_CREATE_ISSUE",
      description: "Create an issue",
      source: "composio" as const,
      toolkit: "github",
      connected: true,
    },
    {
      name: "GITHUB_GET_ISSUE",
      description: "Get an issue",
      source: "composio" as const,
      toolkit: "github",
      connected: true,
    },
  ];

  expect(gatewayToolkitNames(["GITHUB_CREATE_ISSUE", "GITHUB_GET_ISSUE"], catalog)).toEqual([
    "github",
  ]);
});
