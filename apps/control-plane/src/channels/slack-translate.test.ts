import { expect, test } from "bun:test";
import { slackEventToInput } from "./slack-translate.ts";

test("strips the bot mention and trims", () => {
  const out = slackEventToInput(
    { channel: "C1", ts: "1.0", text: "<@U123> review this  " },
    "echo",
  );
  expect(out.userMessage).toBe("review this");
  expect(out.agentId).toBe("echo");
  expect(out.source).toBe("slack");
});

test("sourceKey uses thread_ts when present", () => {
  const out = slackEventToInput({ channel: "C1", ts: "2.0", thread_ts: "1.0" }, "echo");
  expect(out.sourceKey).toBe("C1:1.0");
});

test("sourceKey falls back to ts for a top-level mention", () => {
  const out = slackEventToInput({ channel: "C1", ts: "2.0" }, "echo");
  expect(out.sourceKey).toBe("C1:2.0");
});

test("missing text yields an empty message", () => {
  const out = slackEventToInput({ channel: "C1", ts: "1.0" }, "echo");
  expect(out.userMessage).toBe("");
});
