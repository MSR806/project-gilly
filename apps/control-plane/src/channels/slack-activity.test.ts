import { expect, test } from "bun:test";
import { appendSlackActivity, renderSlackActivity, toSlackActivity } from "./slack-activity.ts";

test("compacts generated workspace paths for Slack without changing the event", () => {
  const event = {
    type: "tool" as const,
    name: "Read",
    summary:
      "/Users/msr/project-gilly/data/workspaces/9d217d8f-a28a-4dd0-898d-70ed41238ee7/vaani-backend/app/services/translation/translation_service.py",
  };

  expect(toSlackActivity(event)).toEqual({
    count: 1,
    details: "translation_service.py",
    groupKey: "file:read",
    title: "Read",
    unit: "reads",
  });
  expect(event.summary).toContain("/data/workspaces/");
});

test("groups adjacent file operations while keeping the latest compact target", () => {
  const first = toSlackActivity({ type: "tool", name: "Read", summary: "/one/first.ts" });
  const second = toSlackActivity({ type: "tool", name: "Read", summary: "/two/second.ts" });
  const groups = appendSlackActivity(appendSlackActivity([], first), second);

  expect(groups).toEqual([
    { count: 2, details: "second.ts", groupKey: "file:read", title: "Read", unit: "reads" },
  ]);
  const group = groups[0];
  expect(group).toBeDefined();
  if (group) expect(renderSlackActivity(group)).toBe("• *Read* — second.ts · 2 reads");
});

test("uses only the filename for relative paths and extensionless files", () => {
  expect(toSlackActivity({ type: "tool", name: "Read", summary: "src/index.ts" }).details).toBe(
    "index.ts",
  );
  expect(toSlackActivity({ type: "tool", name: "Read", summary: "docs/Dockerfile" }).details).toBe(
    "Dockerfile",
  );
});

test("summarizes repeated runner scripts mechanically and ignores flag values", () => {
  const first = toSlackActivity({
    type: "tool",
    name: "Bash",
    summary:
      "bun .claude/skills/marketing-metrics/metrics.ts branch_cpi --slug first --start 2026-06-23",
  });
  const second = toSlackActivity({
    type: "tool",
    name: "Bash",
    summary:
      "bun .claude/skills/marketing-metrics/metrics.ts branch_cpi --slug second --start 2026-06-24",
  });
  const groups = appendSlackActivity(appendSlackActivity([], first), second);

  expect(first).toEqual({
    count: 1,
    details: "metrics.ts",
    groupKey: "command:metrics.ts",
    title: "Bash",
    unit: "runs",
  });
  const group = groups[0];
  expect(group).toBeDefined();
  if (group) {
    expect(renderSlackActivity(group)).toBe("• *Bash* — metrics.ts · 2 runs");
  }
});

test("does not expose runner task names or positional script arguments", () => {
  expect(
    toSlackActivity({ type: "tool", name: "Bash", summary: "bun run customer-task" }).details,
  ).toBe("bun run");
  expect(
    toSlackActivity({ type: "tool", name: "Bash", summary: "python script.py customer-token" })
      .details,
  ).toBe("script.py");
});

test("keeps different searches separate without exposing their arguments", () => {
  const first = toSlackActivity({
    type: "tool",
    name: "Bash",
    summary: 'grep -r "global_mapping" vaani-backend --include="*.py"',
  });
  const repeat = toSlackActivity({
    type: "tool",
    name: "Bash",
    summary: 'grep -r "global_mapping" vaani-backend --include="*.py"',
  });
  const different = toSlackActivity({
    type: "tool",
    name: "Bash",
    summary: 'grep -r "translation_mapping" vaani-backend --include="*.py"',
  });

  expect(first.details).toBe("grep");
  expect(repeat.groupKey).toBe(first.groupKey);
  expect(different.groupKey).not.toBe(first.groupKey);
});

test("hides positional values for direct CLI commands", () => {
  expect(
    toSlackActivity({ type: "tool", name: "Bash", summary: "git status --porcelain=v1" }).details,
  ).toBe("git");
  expect(
    toSlackActivity({ type: "tool", name: "Bash", summary: "git customer-token" }).details,
  ).toBe("git");
  expect(
    toSlackActivity({ type: "tool", name: "Bash", summary: "cat private-report.txt" }).details,
  ).toBe("cat");
});

test("sanitizes command-tool aliases and hides unknown tool summaries", () => {
  expect(
    toSlackActivity({ type: "tool", name: "Shell", summary: "TOKEN=secret git status" }).details,
  ).toBe("git");
  expect(
    toSlackActivity({ type: "tool", name: "FutureTool", summary: "Bearer secret-token" }).details,
  ).toBeUndefined();
});

test("retains only the latest three display groups", () => {
  const events = [
    { type: "tool" as const, name: "Read", summary: "one.ts" },
    { type: "tool" as const, name: "Edit", summary: "two.ts" },
    { type: "tool" as const, name: "Write", summary: "three.ts" },
    { type: "tool" as const, name: "Custom", summary: "four" },
  ];
  const groups = events.reduce<readonly ReturnType<typeof toSlackActivity>[]>(
    (current, event) => appendSlackActivity(current, toSlackActivity(event)),
    [],
  );

  expect(groups.map(({ title }) => title)).toEqual(["Edit", "Write", "Custom"]);
});

test("truncates safe activity and keeps message formatting compact", () => {
  const tool = toSlackActivity({
    type: "tool",
    name: "Skill",
    summary: "detail ".repeat(30),
  });
  const message = toSlackActivity({
    type: "message",
    text: `${"Thinking ".repeat(20)}\nmore detail`,
  });

  expect(tool.details?.length).toBeLessThanOrEqual(72);
  expect(message.title.length).toBeLessThanOrEqual(72);
  expect(message.title).not.toContain("more detail");
});
