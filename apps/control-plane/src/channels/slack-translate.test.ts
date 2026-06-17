import { expect, test } from "bun:test";
import { assistantMessageToInput } from "./slack-translate.ts";

test("sourceKey uses thread_ts when present", () => {
  const out = assistantMessageToInput(
    { channel: "C1", ts: "2.0", thread_ts: "1.0", text: "hi" },
    "echo",
  );
  expect(out.sourceKey).toBe("C1:1.0");
  expect(out.agentId).toBe("echo");
  expect(out.source).toBe("slack");
});

test("sourceKey falls back to ts for the opening message", () => {
  const out = assistantMessageToInput({ channel: "C1", ts: "2.0" }, "echo");
  expect(out.sourceKey).toBe("C1:2.0");
});

test("trims the message text", () => {
  const out = assistantMessageToInput({ channel: "C1", ts: "1.0", text: "  hello  " }, "echo");
  expect(out.userMessage).toBe("hello");
});

test("missing text yields an empty message", () => {
  const out = assistantMessageToInput({ channel: "C1", ts: "1.0" }, "echo");
  expect(out.userMessage).toBe("");
});
