/// <reference types="bun" />

import { expect, test } from "bun:test";
import { appendActivityPart, messagesFromRuns, type Part } from "./history";

test("messagesFromRuns rebuilds turns with narration, tools, final output, and failures", () => {
  expect(
    messagesFromRuns([
      {
        id: "run-1",
        status: "completed",
        input: "Inspect it",
        output: "It is healthy.",
        error: null,
        createdAt: 1,
        steps: [
          { type: "message", text: "I’ll inspect it." },
          { type: "tool", name: "Read", summary: "package.json" },
          { type: "message", text: "Now I’ll run the checks." },
          { type: "tool", name: "Bash", summary: "bun test" },
        ],
      },
      {
        id: "run-2",
        status: "error",
        input: "Try again",
        output: null,
        error: "Runtime unavailable",
        createdAt: 2,
        steps: [{ type: "error", error: "Runtime unavailable" }],
      },
    ]),
  ).toEqual([
    { role: "user", parts: [{ kind: "text", text: "Inspect it" }] },
    {
      role: "assistant",
      parts: [
        { kind: "text", text: "I’ll inspect it." },
        { kind: "activity", items: [{ name: "Read", summary: "package.json" }] },
        { kind: "text", text: "Now I’ll run the checks." },
        { kind: "activity", items: [{ name: "Bash", summary: "bun test" }] },
        { kind: "text", text: "It is healthy." },
      ],
    },
    { role: "user", parts: [{ kind: "text", text: "Try again" }] },
    { role: "assistant", parts: [{ kind: "error", error: "Runtime unavailable" }] },
  ]);
});

test("appendActivityPart preserves activity around intervening narration", () => {
  let parts: Part[] = [];
  parts = appendActivityPart(parts, { name: "Read", summary: "first.ts" });
  parts.push({ kind: "text", text: "Now checking another file." });
  parts = appendActivityPart(parts, { name: "Read", summary: "second.ts" });

  expect(parts).toEqual([
    { kind: "activity", items: [{ name: "Read", summary: "first.ts" }] },
    { kind: "text", text: "Now checking another file." },
    { kind: "activity", items: [{ name: "Read", summary: "second.ts" }] },
  ]);
});

test("appendActivityPart keeps adjacent tool calls in one activity block", () => {
  let parts: Part[] = [];
  parts = appendActivityPart(parts, { name: "Read", summary: "first.ts" });
  parts = appendActivityPart(parts, { name: "Read", summary: "second.ts" });

  expect(parts).toEqual([
    {
      kind: "activity",
      items: [
        { name: "Read", summary: "first.ts" },
        { name: "Read", summary: "second.ts" },
      ],
    },
  ]);
});
