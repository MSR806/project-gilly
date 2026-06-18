import { expect, test } from "bun:test";
import { fallbackText, toBlocks } from "./slack-format.ts";

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
