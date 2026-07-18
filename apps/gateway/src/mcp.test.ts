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

test("normalizeMcpResult unwraps a legacy toolResult containing an MCP envelope", () => {
  expect(
    normalizeMcpResult({
      toolResult: {
        content: [{ type: "text", text: '{"success":true,"data":{"users":970}}' }],
      },
    }),
  ).toEqual({ success: true, data: { users: 970 } });
});

test("normalizeMcpResult unwraps an MCP envelope nested in structured content", () => {
  expect(
    normalizeMcpResult({
      structuredContent: {
        content: [{ type: "text", text: '{"success":true,"data":{"users":970}}' }],
      },
      content: [{ type: "text", text: "ignored" }],
    }),
  ).toEqual({ success: true, data: { users: 970 } });
});

test("normalizeMcpResult bounds nested envelopes and keeps application data authoritative", () => {
  const innermostEnvelope = JSON.stringify({
    content: [{ type: "text", text: '{"users":970}' }],
  });
  let nested = innermostEnvelope;
  for (let i = 1; i < 6; i++) {
    nested = JSON.stringify({ content: [{ type: "text", text: nested }] });
  }

  expect(normalizeMcpResult({ content: [{ type: "text", text: nested }] })).toEqual({
    content: [{ type: "text", text: innermostEnvelope }],
  });
  expect(
    normalizeMcpResult({
      structuredContent: { content: ["application data"] },
      content: [{ type: "text", text: "ignored" }],
    }),
  ).toEqual({ content: ["application data"] });
});
