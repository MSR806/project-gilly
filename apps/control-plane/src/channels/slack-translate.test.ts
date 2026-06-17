import { expect, test } from "bun:test";
import { assistantMessageToInput, mentionEventToInput } from "./slack-translate.ts";

test("assistant: sourceKey uses thread_ts, text trimmed, no mention stripping", () => {
  const out = assistantMessageToInput(
    { channel: "C1", ts: "2.0", thread_ts: "1.0", text: "  hi  " },
    "echo",
  );
  expect(out.sourceKey).toBe("C1:1.0");
  expect(out.userMessage).toBe("hi");
  expect(out.agentId).toBe("echo");
});

test("assistant: sourceKey falls back to ts for the opening message", () => {
  const out = assistantMessageToInput({ channel: "C1", ts: "2.0" }, "echo");
  expect(out.sourceKey).toBe("C1:2.0");
});

test("mention: strips the bot mention and trims", () => {
  const out = mentionEventToInput(
    { channel: "C1", ts: "1.0", text: "<@U123> review this  " },
    "echo",
  );
  expect(out.userMessage).toBe("review this");
});

test("mention: sourceKey uses thread_ts when in a thread, else ts", () => {
  expect(
    mentionEventToInput({ channel: "C1", ts: "2.0", thread_ts: "1.0" }, "echo").sourceKey,
  ).toBe("C1:1.0");
  expect(mentionEventToInput({ channel: "C1", ts: "2.0" }, "echo").sourceKey).toBe("C1:2.0");
});

test("missing text yields an empty message", () => {
  expect(assistantMessageToInput({ channel: "C1", ts: "1.0" }, "echo").userMessage).toBe("");
  expect(mentionEventToInput({ channel: "C1", ts: "1.0" }, "echo").userMessage).toBe("");
});
