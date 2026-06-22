import { expect, test } from "bun:test";
import { advanceSteps, closeSteps, fallbackText, newStepState, toBlocks } from "./slack-format.ts";

test("toBlocks wraps markdown in a single markdown block", () => {
  const blocks = toBlocks("**Hello** _world_");
  expect(blocks).toEqual([{ type: "markdown", text: "**Hello** _world_" }]);
});

test("toBlocks chunks content past the 12k limit into multiple blocks", () => {
  const big = `${"a".repeat(8000)}\n${"b".repeat(8000)}`;
  const blocks = toBlocks(big);
  expect(blocks.length).toBeGreaterThan(1);
  expect(blocks.every((b) => b.type === "markdown" && b.text.length <= 12000)).toBe(true);
});

test("toBlocks never produces an empty block", () => {
  expect(toBlocks("   ")).toEqual([{ type: "markdown", text: "_(no response)_" }]);
});

test("fallbackText truncates long text", () => {
  expect(fallbackText("short")).toBe("short");
  expect(fallbackText("x".repeat(500))).toHaveLength(198); // 197 + ellipsis
});

test("advanceSteps opens an in-progress step for a tool, with the arg summary as details", () => {
  const { state, chunks } = advanceSteps(newStepState(), {
    type: "tool",
    name: "Read",
    summary: "src/index.ts",
  });
  expect(chunks).toEqual([
    {
      type: "task_update",
      id: "step-1",
      title: "Read",
      status: "in_progress",
      details: "src/index.ts",
    },
  ]);
  expect(state).toEqual({ count: 1, open: { id: "step-1", title: "Read" } });
});

test("advanceSteps completes the prior step when the next one opens", () => {
  const first = advanceSteps(newStepState(), { type: "tool", name: "Read", summary: "" });
  const second = advanceSteps(first.state, {
    type: "message",
    text: "Now I'll run the tests\nand report back",
  });
  expect(second.chunks).toEqual([
    { type: "task_update", id: "step-1", title: "Read", status: "complete" },
    // Narration step: first line is the title, the remaining lines are the sub-line.
    {
      type: "task_update",
      id: "step-2",
      title: "Now I'll run the tests",
      status: "in_progress",
      details: "and report back",
    },
  ]);
  expect(second.state.count).toBe(2);
});

test("advanceSteps: a single-line narration has no details (would just repeat the title)", () => {
  const { chunks } = advanceSteps(newStepState(), { type: "message", text: "Checking the PRs" });
  expect(chunks).toEqual([
    { type: "task_update", id: "step-1", title: "Checking the PRs", status: "in_progress" },
  ]);
});

test("advanceSteps: a long single-line narration trims the title but keeps the full sub-line", () => {
  const long = "x".repeat(300);
  const { chunks } = advanceSteps(newStepState(), { type: "message", text: long });
  const step = chunks[0] as { title: string; details: string };
  expect(step.title).toHaveLength(150); // 149 + ellipsis
  expect(step.details).toBe(long);
});

test("advanceSteps ignores token/done/error events (no steps)", () => {
  const start = newStepState();
  expect(advanceSteps(start, { type: "token", text: "hi" })).toEqual({ state: start, chunks: [] });
});

test("closeSteps settles the open step (complete, or error)", () => {
  const { state } = advanceSteps(newStepState(), { type: "tool", name: "Bash", summary: "ls" });
  expect(closeSteps(state, false)).toEqual([
    { type: "task_update", id: "step-1", title: "Bash", status: "complete" },
  ]);
  expect(closeSteps(state, true)).toEqual([
    { type: "task_update", id: "step-1", title: "Bash", status: "error" },
  ]);
  expect(closeSteps(newStepState(), false)).toEqual([]); // nothing open → nothing to close
});
