/// <reference types="bun" />

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityBlock, Markdown } from "./page";

test("Markdown renders GFM tables and inline formatting", () => {
  const html = renderToStaticMarkup(
    <Markdown>{"**Agents**\n\n| ID | Model |\n|---|---|\n| `echo` | sonnet |"}</Markdown>,
  );

  expect(html).toContain("<strong>Agents</strong>");
  expect(html).toContain("<table");
  expect(html).toContain("<code>echo</code>");
});

test("ActivityBlock is collapsed after completion and does not render raw command arguments", () => {
  const html = renderToStaticMarkup(
    <ActivityBlock
      running={false}
      items={[
        {
          name: "Bash",
          summary: "bun scripts/metrics.ts branch_cpi --slug secret-id --start 2026-06-23",
        },
      ]}
    />,
  );

  expect(html).toContain("Activity · 1 step");
  expect(html).toContain("metrics.ts");
  expect(html).not.toContain("branch_cpi");
  expect(html).not.toContain('open=""');
  expect(html).not.toContain("secret-id");
});

test("ActivityBlock limits running detail to the latest five groups", () => {
  const html = renderToStaticMarkup(
    <ActivityBlock
      running
      items={Array.from({ length: 7 }, (_, index) => ({
        name: "Skill",
        summary: `operation-${index + 1}`,
      }))}
    />,
  );

  expect(html).toContain('open=""');
  expect(html).toContain("2 earlier groups");
  expect(html).not.toContain("operation-1");
  expect(html).toContain("operation-7");
});
