/// <reference types="bun" />

import { expect, test } from "bun:test";
import { type ActivityItem, compactCommand, groupActivity } from "./activity";

test("compactCommand keeps a conservative command label while hiding arguments", () => {
  expect(
    compactCommand(
      "bun .claude/skills/marketing-metrics/metrics.ts branch_cpi --slug t6ypby --start 2026-06-23",
    ),
  ).toBe("metrics.ts");
  expect(compactCommand('grep -r "global_mapping|translation.*mapping" vaani-backend')).toBe(
    "grep",
  );
  expect(compactCommand("cd repo && git status --short")).toBe("git");
  expect(compactCommand("bun run typecheck --filter web")).toBe("bun run");
  expect(compactCommand("python -m pytest tests/unit")).toBe("python -m");
  expect(compactCommand("echo secret-token")).toBe("echo");
  expect(compactCommand("bun scripts/run.ts --token secret-token")).toBe("run.ts");
  expect(compactCommand("bun scripts/run.ts customer-token")).toBe("run.ts");
  expect(compactCommand("API_TOKEN=secret git status")).toBe("git");
  expect(compactCommand("cd repo && API_TOKEN=secret git status")).toBe("git");
});

test("groupActivity strips workspace prefixes and groups consecutive file operations", () => {
  const prefix =
    "/Users/msr/project-gilly/data/workspaces/9d217d8f-a28a-4dd0-898d-70ed41238ee7/vaani-backend";
  const items: ActivityItem[] = [
    { name: "Read", summary: `${prefix}/app/services/translation_service.py` },
    { name: "Read", summary: `${prefix}/app/utils/translation_mappings.py` },
    { name: "Read", summary: `${prefix}/app/repository/book_repository.py` },
  ];

  expect(groupActivity(items)).toEqual([
    {
      label: "Read",
      detail: "3 reads · translation_service.py, translation_mappings.py +1",
      count: 3,
    },
  ]);
  expect(items[0]?.summary).toBe(`${prefix}/app/services/translation_service.py`);
});

test("groupActivity combines repeated commands without domain-specific interpretation", () => {
  const commands = ["one", "two", "three", "four"].map((slug) => ({
    name: "Bash",
    summary: `bun .claude/skills/marketing-metrics/metrics.ts branch_cpi --slug ${slug}`,
  }));

  expect(groupActivity([{ name: "Skill", summary: "marketing-metrics" }, ...commands])).toEqual([
    { label: "Skill", detail: "marketing-metrics", count: 1 },
    { label: "Bash", detail: "metrics.ts · 4 runs", count: 4 },
  ]);
});

test("labels repeated operations as invocations rather than unique files", () => {
  expect(
    groupActivity([
      { name: "Edit", summary: "same.ts" },
      { name: "Edit", summary: "same.ts" },
    ]),
  ).toEqual([{ label: "Edit", detail: "2 edits · same.ts", count: 2 }]);
});

test("strips the MCP prefix and shows gateway tool arguments", () => {
  expect(
    groupActivity([
      { name: "mcp__gateway__gateway_catalog", summary: "amplitude" },
      { name: "mcp__gateway__gateway_invoke", summary: "amplitude.query_events — funnels" },
    ]),
  ).toEqual([
    { label: "gateway_catalog", detail: "amplitude", count: 1 },
    { label: "gateway_invoke", detail: "amplitude.query_events — funnels", count: 1 },
  ]);
});

test("sanitizes command aliases and hides unknown tool summaries", () => {
  expect(groupActivity([{ name: "exec_command", summary: "TOKEN=secret git status" }])).toEqual([
    { label: "exec_command", detail: "git", count: 1 },
  ]);
  expect(groupActivity([{ name: "FutureTool", summary: "Bearer secret-token" }])).toEqual([
    { label: "FutureTool", detail: "", count: 1 },
  ]);
});
