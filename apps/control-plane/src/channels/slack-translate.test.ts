import { expect, test } from "bun:test";
import {
  assistantMessageToInput,
  formatTranscript,
  mentionEventToInput,
} from "./slack-translate.ts";

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

test("userId passes through both translators when resolved", () => {
  expect(
    assistantMessageToInput({ channel: "C1", ts: "1.0" }, "echo", "slack", "u-42").userId,
  ).toBe("u-42");
  expect(mentionEventToInput({ channel: "C1", ts: "1.0" }, "echo", "slack", "u-42").userId).toBe(
    "u-42",
  );
});

test("missing text yields an empty message", () => {
  expect(assistantMessageToInput({ channel: "C1", ts: "1.0" }, "echo").userMessage).toBe("");
  expect(mentionEventToInput({ channel: "C1", ts: "1.0" }, "echo").userMessage).toBe("");
});

test("formatTranscript labels authors, skips empties and the excluded ts", () => {
  const out = formatTranscript(
    [
      { user: "U1", text: "deploy is failing", ts: "1.0" },
      { bot_id: "B1", text: "looking into it", ts: "2.0" },
      { user: "U1", text: "  ", ts: "3.0" },
      { user: "U2", text: "@gilly help", ts: "4.0" },
    ],
    "4.0",
  );
  expect(out).toBe("<@U1>: deploy is failing\nassistant: looking into it");
});
