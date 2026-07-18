import { expect, test } from "bun:test";
import {
  fallbackText,
  newProgressState,
  reduceProgress,
  renderProgress,
  toProgressMessage,
  toSlackMessages,
  withRunSummary,
} from "./slack-format.ts";

test("toSlackMessages wraps markdown in one message", () => {
  expect(toSlackMessages("**Hello** _world_")).toEqual([
    {
      blocks: [{ type: "markdown", text: "**Hello** _world_" }],
      text: "**Hello** _world_",
    },
  ]);
});

test("toSlackMessages splits content at message boundaries, not into blocks", () => {
  const messages = toSlackMessages(`${"a".repeat(8000)}\n\n${"b".repeat(8000)}`);
  expect(messages).toHaveLength(2);
  expect(messages.every(({ blocks }) => blocks.length === 1)).toBe(true);
  expect(
    messages.every(({ blocks }) =>
      blocks.every((block) => block.type === "markdown" && block.text.length <= 12000),
    ),
  ).toBe(true);
});

test("toSlackMessages handles the 12k boundary", () => {
  expect(toSlackMessages("x".repeat(11999))).toHaveLength(1);
  expect(toSlackMessages("x".repeat(12000))).toHaveLength(1);
  expect(toSlackMessages("x".repeat(12001))).toHaveLength(2);
});

test("toSlackMessages closes and reopens fenced code split across messages", () => {
  const source = `Before\n\n\`\`\`ts\n${"const value = 1;\n".repeat(900)}\`\`\`\n\nAfter`;
  const messages = toSlackMessages(source);
  expect(messages.length).toBeGreaterThan(1);
  const firstText = messages[0]?.blocks[0];
  const secondText = messages[1]?.blocks[0];
  expect(firstText?.type === "markdown" ? firstText.text.endsWith("```") : false).toBe(true);
  expect(secondText?.type === "markdown" ? secondText.text.startsWith("```ts\n") : false).toBe(
    true,
  );
  expect(
    messages.every(({ blocks }) => {
      const block = blocks[0];
      return block?.type === "markdown" && block.text.length <= 12000;
    }),
  ).toBe(true);
});

test("toSlackMessages preserves whitespace at fenced code split boundaries", () => {
  const source = `\`\`\`text\n${"x".repeat(11800)}    \n${"y".repeat(1000)}\n\`\`\``;
  const messages = toSlackMessages(source);
  const first = messages[0]?.blocks[0];

  expect(
    first?.type === "markdown" ? first.text.includes(`${"x".repeat(20)}    \n\`\`\``) : false,
  ).toBe(true);
});

test("toSlackMessages never produces an empty payload", () => {
  expect(toSlackMessages("   ")).toEqual([
    {
      blocks: [{ type: "markdown", text: "_(no response)_" }],
      text: "_(no response)_",
    },
  ]);
});

test("fallbackText truncates long text", () => {
  expect(fallbackText("short")).toBe("short");
  expect(fallbackText("x".repeat(500))).toHaveLength(198);
});

test("reduceProgress ignores non-operation events", () => {
  const state = newProgressState();
  expect(reduceProgress(state, { type: "token", text: "hello" })).toBe(state);
  expect(reduceProgress(state, { type: "done", finalText: "done", harnessSessionId: null })).toBe(
    state,
  );
  expect(reduceProgress(state, { type: "error", error: "failed" })).toBe(state);
});

test("reduceProgress renders a compact tool and narration timeline", () => {
  const first = reduceProgress(newProgressState(), {
    type: "message",
    text: "I’ll inspect the repository.\nThis detail is intentionally omitted.",
  });
  const second = reduceProgress(first, {
    type: "tool",
    name: "Read",
    summary: "src/index.ts",
  });
  expect(second).toEqual({
    totalSteps: 2,
    recentSteps: [
      {
        count: 1,
        groupKey: expect.stringContaining("message:"),
        title: "I’ll inspect the repository.",
        unit: "steps",
      },
      {
        count: 1,
        details: "index.ts",
        groupKey: "file:read",
        title: "Read",
        unit: "reads",
      },
    ],
  });
  expect(renderProgress(second)).toBe(
    "Working · 2 steps\n• *I’ll inspect the repository.*\n• *Read* — index.ts",
  );
});

test("reduceProgress keeps the full count and groups repeated Slack activities", () => {
  let state = newProgressState();
  for (let index = 1; index <= 60; index += 1) {
    state = reduceProgress(state, { type: "tool", name: "Read", summary: `file-${index}.ts` });
  }

  expect(state.totalSteps).toBe(60);
  expect(state.recentSteps).toEqual([
    {
      count: 60,
      details: "file-60.ts",
      groupKey: "file:read",
      title: "Read",
      unit: "reads",
    },
  ]);
  expect(renderProgress(state)).toBe("Working · 60 steps\n• *Read* — file-60.ts · 60 reads");
  expect(renderProgress(state)).not.toContain("file-59.ts");
});

test("renderProgress uses sensible zero and singular copy", () => {
  expect(renderProgress(newProgressState())).toBe("Working · starting…");
  const one = reduceProgress(newProgressState(), { type: "tool", name: "Bash", summary: "" });
  expect(renderProgress(one)).toBe("Working · 1 step\n• *Bash*");
});

test("toProgressMessage renders a documented container block", () => {
  expect(toProgressMessage(newProgressState())).toEqual({
    blocks: [
      {
        type: "container",
        title: { type: "plain_text", text: "Working…" },
        subtitle: { type: "plain_text", text: "Starting…" },
        is_collapsible: false,
        default_collapsed: false,
        child_blocks: [
          { type: "divider" },
          {
            type: "context",
            elements: [{ type: "plain_text", text: "Preparing the run…" }],
          },
        ],
      },
    ],
    text: "Working · starting…",
  });
});

test("toProgressMessage puts recent activity inside the container", () => {
  const state = reduceProgress(newProgressState(), {
    type: "tool",
    name: "Read",
    summary: "src/index.ts",
  });

  expect(toProgressMessage(state)).toEqual({
    blocks: [
      {
        type: "container",
        title: { type: "plain_text", text: "Working…" },
        subtitle: { type: "plain_text", text: "1 step completed" },
        is_collapsible: false,
        default_collapsed: false,
        child_blocks: [
          { type: "divider" },
          {
            type: "section",
            text: { type: "mrkdwn", text: "• *Read* — index.ts" },
          },
        ],
      },
    ],
    text: "Working · 1 step\n• *Read* — index.ts",
  });
});

test("withRunSummary collapses completed activity beside the final Markdown", () => {
  const state = reduceProgress(newProgressState(), {
    type: "tool",
    name: "Bash",
    summary: "bun test",
  });
  const [message] = toSlackMessages("**Done**");
  if (!message) throw new Error("expected one Slack message");

  expect(withRunSummary(message, state, false)).toEqual({
    blocks: [
      {
        type: "container",
        title: { type: "plain_text", text: "Completed" },
        subtitle: { type: "plain_text", text: "1 step completed" },
        is_collapsible: true,
        default_collapsed: true,
        child_blocks: [
          { type: "divider" },
          {
            type: "section",
            text: { type: "mrkdwn", text: "• *Bash* — test" },
          },
        ],
      },
      { type: "markdown", text: "**Done**" },
    ],
    text: "**Done**",
  });
});

test("withRunSummary marks failed activity", () => {
  const [message] = toSlackMessages("⚠️ runtime failed");
  if (!message) throw new Error("expected one Slack message");

  expect(withRunSummary(message, newProgressState(), true).blocks[0]).toEqual({
    type: "container",
    title: { type: "plain_text", text: "Failed" },
    subtitle: { type: "plain_text", text: "Stopped before starting" },
    is_collapsible: true,
    default_collapsed: true,
    child_blocks: [
      { type: "divider" },
      {
        type: "context",
        elements: [{ type: "plain_text", text: "Preparing the run…" }],
      },
    ],
  });
});
