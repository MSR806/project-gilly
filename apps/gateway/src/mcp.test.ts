import { expect, test } from "bun:test";
import { normalizeMcpResult } from "./mcp.ts";

test("normalizeMcpResult unwraps simple results and preserves complex content", () => {
  expect(normalizeMcpResult({ toolResult: { issues: ["FR-230"] } })).toEqual({
    issues: ["FR-230"],
  });
  expect(
    normalizeMcpResult({
      structuredContent: { issues: ["FR-230"] },
      content: [{ type: "text", text: "ignored" }],
    }),
  ).toEqual({ issues: ["FR-230"] });
  expect(
    normalizeMcpResult({ content: [{ type: "text", text: '{"issues":["FR-230"]}' }] }),
  ).toEqual({ issues: ["FR-230"] });
  expect(normalizeMcpResult({ content: [{ type: "text", text: "done" }] })).toBe("done");

  const content = [
    { type: "text", text: "caption" },
    { type: "image", data: "base64" },
  ];
  expect(normalizeMcpResult({ content })).toEqual(content);
});

test("normalizeMcpResult keeps unwrapping when an upstream double-wraps its own envelope", () => {
  const inner = JSON.stringify({ data: { csvResponse: { data: [["Total", "1"]] } } });
  const doubleWrapped = JSON.stringify({ content: [{ type: "text", text: inner }] });
  expect(normalizeMcpResult({ content: [{ type: "text", text: doubleWrapped }] })).toEqual({
    data: { csvResponse: { data: [["Total", "1"]] } },
  });
});
