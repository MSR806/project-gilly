import { expect, test } from "bun:test";
import { InvocationRequest, InvocationResult } from "./index.ts";

test("InvocationRequest round-trips a minimal payload", () => {
  const req = {
    agent: {
      id: "a",
      name: "A",
      harness: { id: "claude", config: { model: "claude-sonnet-4-5" } },
      systemPrompt: "do x",
    },
    userMessage: "hello",
  };
  expect(InvocationRequest.parse(req)).toMatchObject(req);
});

test("InvocationRequest carries inline skills", () => {
  const req = {
    agent: {
      id: "release-bot",
      name: "Release Bot",
      harness: { id: "codex", config: { model: "gpt-5.2", serviceTier: "fast" } },
      systemPrompt: "ship it",
      skills: ["cut-release"],
    },
    userMessage: "cut 1.4.0",
    skills: [{ name: "cut-release", files: [{ path: "SKILL.md", contents: "# go" }] }],
  };
  expect(InvocationRequest.parse(req)).toMatchObject(req);
});

test("InvocationRequest requires nested harness config and accepts data-backed harness ids", () => {
  const req = {
    agent: {
      id: "a",
      name: "A",
      harness: { id: "custom", config: { model: "model" } },
      systemPrompt: "do x",
    },
    userMessage: "hello",
  };
  expect(InvocationRequest.safeParse(req).success).toBe(true);
  expect(
    InvocationRequest.safeParse({ ...req, agent: { ...req.agent, harness: undefined, model: "m" } })
      .success,
  ).toBe(false);
});

test("InvocationResult requires nullable fields to be present", () => {
  const ok = InvocationResult.safeParse({
    status: "completed",
    finalText: "done",
    harnessSessionId: "s1",
    error: null,
  });
  expect(ok.success).toBe(true);
});
