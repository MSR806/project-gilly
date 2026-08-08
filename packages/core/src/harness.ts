import { z } from "zod";

export const HarnessModel = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type HarnessModel = z.infer<typeof HarnessModel>;

export const HarnessDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    image: z
      .string()
      .regex(
        /^\/[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(svg|png|webp)$/,
        "Harness image must be a local asset path",
      )
      .optional(),
    enabled: z.boolean(),
    models: z.array(HarnessModel),
  })
  .refine(
    (harness) => new Set(harness.models.map((model) => model.id)).size === harness.models.length,
    {
      message: "Harness model ids must be unique",
      path: ["models"],
    },
  );
export type HarnessDefinition = z.infer<typeof HarnessDefinition>;

export const BUILT_IN_HARNESSES = [
  {
    id: "claude",
    name: "Claude",
    image: "/harnesses/claude.svg",
    enabled: true,
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    image: "/harnesses/codex.svg",
    enabled: true,
    models: [
      { id: "gpt-5.5", name: "GPT-5.5" },
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "gpt-5.2", name: "GPT-5.2" },
      { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    ],
  },
] as const satisfies readonly HarnessDefinition[];

export const AgentHarness = z.object({
  id: z.string().min(1),
  config: z.object({
    model: z.string().min(1),
    serviceTier: z.string().min(1).optional(),
  }),
});
export type AgentHarness = z.infer<typeof AgentHarness>;

/** Open-model execution remains unavailable until a matching harness runner ships. */
export function isDeferredOpenModel(model: string): boolean {
  return model.toLowerCase().startsWith("gpt-oss");
}

/** Migration-only conversion for legacy flat model configs and database rows. */
export function normalizeLegacyHarness(model: string): AgentHarness {
  if (model === "gpt-5.4-fast") {
    return { id: "codex", config: { model: "gpt-5.4", serviceTier: "fast" } };
  }
  const normalized = model.toLowerCase();
  const codex =
    normalized.startsWith("gpt-") ||
    normalized.startsWith("openai/") ||
    normalized.startsWith("codex-") ||
    /^o\d(?:-|$)/.test(normalized);
  return { id: codex ? "codex" : "claude", config: { model } };
}
