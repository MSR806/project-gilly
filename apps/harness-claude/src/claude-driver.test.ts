import { expect, test } from "bun:test";
import type { query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { InvocationRequest } from "@gilly/harness-protocol";
import { ClaudeSdkHarnessDriver } from "./claude-driver.ts";

const msg = (o: unknown) => o as SDKMessage;
const init = (id: string) => msg({ type: "system", subtype: "init", session_id: id });
const result = (text: string) => msg({ type: "result", subtype: "success", result: text });
const toolUse = (name: string, input: unknown) =>
  msg({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

async function* stream(...msgs: SDKMessage[]) {
  yield* msgs;
}

const req: InvocationRequest = {
  agent: { id: "a", name: "A", model: "claude-sonnet-4-5", systemPrompt: "do x" },
  userMessage: "hi",
};

test("ClaudeSdkHarnessDriver.name is 'claude-sdk'", () => {
  const driver = new ClaudeSdkHarnessDriver((() => stream()) as unknown as typeof query);
  expect(driver.name).toBe("claude-sdk");
});

test("ClaudeSdkHarnessDriver.invoke delegates to runAgentLoop", async () => {
  const queryFn = (() => stream(init("s1"), result("done"))) as unknown as typeof query;
  const driver = new ClaudeSdkHarnessDriver(queryFn);
  const out = await driver.invoke(req);
  expect(out).toEqual({
    status: "completed",
    finalText: "done",
    harnessSessionId: "s1",
    error: null,
  });
});

test("ClaudeSdkHarnessDriver.invoke returns error result on failure", async () => {
  const queryFn = (() => {
    throw new Error("sdk-boom");
  }) as unknown as typeof query;
  const driver = new ClaudeSdkHarnessDriver(queryFn);
  const out = await driver.invoke(req);
  expect(out.status).toBe("error");
  expect(out.error).toContain("sdk-boom");
});

test("ClaudeSdkHarnessDriver.invokeStream yields stream events", async () => {
  const queryFn = (() =>
    stream(
      init("s2"),
      toolUse("Bash", { command: "ls" }),
      result("ok"),
    )) as unknown as typeof query;
  const driver = new ClaudeSdkHarnessDriver(queryFn);
  const events = [];
  for await (const ev of driver.invokeStream(req)) events.push(ev);
  expect(events).toEqual([
    { type: "tool", name: "Bash", summary: "ls" },
    { type: "done", finalText: "ok", harnessSessionId: "s2" },
  ]);
});
