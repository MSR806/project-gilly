import { expect, test } from "bun:test";
import { AgentConfig } from "./agent.ts";
import {
  BUILT_IN_HARNESSES,
  HarnessDefinition,
  isDeferredOpenModel,
  normalizeLegacyHarness,
} from "./harness.ts";

test("built-in harness definitions and nested agent config validate", () => {
  expect(BUILT_IN_HARNESSES.map((harness) => HarnessDefinition.parse(harness).id)).toEqual([
    "claude",
    "codex",
  ]);
  expect(BUILT_IN_HARNESSES.map(({ image }) => image)).toEqual([
    "/harnesses/claude.svg",
    "/harnesses/codex.svg",
  ]);
  for (const image of [
    "https://example.com/logo.svg",
    "/\\evil.example/logo.svg",
    "/\t/evil.example/logo.svg",
  ]) {
    expect(() =>
      HarnessDefinition.parse({ id: "remote", name: "Remote", image, enabled: true, models: [] }),
    ).toThrow("Harness image must be a local asset path");
  }
  expect(
    AgentConfig.parse({
      id: "helper",
      name: "Helper",
      harness: { id: "codex", config: { model: "gpt-5.4", serviceTier: "fast" } },
      systemPrompt: "Help.",
    }).harness,
  ).toEqual({ id: "codex", config: { model: "gpt-5.4", serviceTier: "fast" } });
});

test("legacy normalization is migration-only and preserves real model ids", () => {
  expect(normalizeLegacyHarness("gpt-5.4-fast")).toEqual({
    id: "codex",
    config: { model: "gpt-5.4", serviceTier: "fast" },
  });
  expect(normalizeLegacyHarness("openai/custom")).toEqual({
    id: "codex",
    config: { model: "openai/custom" },
  });
  expect(normalizeLegacyHarness("custom-claude")).toEqual({
    id: "claude",
    config: { model: "custom-claude" },
  });
  expect(isDeferredOpenModel("gpt-oss-120b")).toBe(true);
});
