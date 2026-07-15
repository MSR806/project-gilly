/// <reference types="bun" />

import { expect, test } from "bun:test";
import { messagesFromRuns } from "./history";

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
        { kind: "tool", name: "Read", summary: "package.json" },
        { kind: "text", text: "It is healthy." },
      ],
    },
    { role: "user", parts: [{ kind: "text", text: "Try again" }] },
    { role: "assistant", parts: [{ kind: "error", error: "Runtime unavailable" }] },
  ]);
});
