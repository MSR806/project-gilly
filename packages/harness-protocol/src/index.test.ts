import { expect, test } from "bun:test";
import { InvocationRequest, InvocationResult } from "./index.ts";

test("InvocationRequest round-trips a minimal payload", () => {
  const req = {
    agent: { id: "a", name: "A", model: "claude-sonnet-4-5", systemPrompt: "do x" },
    userMessage: "hello",
  };
  expect(InvocationRequest.parse(req)).toMatchObject(req);
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
