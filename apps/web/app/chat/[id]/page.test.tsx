/// <reference types="bun" />

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./page";

test("Markdown renders GFM tables and inline formatting", () => {
  const html = renderToStaticMarkup(
    <Markdown>{"**Agents**\n\n| ID | Model |\n|---|---|\n| `echo` | sonnet |"}</Markdown>,
  );

  expect(html).toContain("<strong>Agents</strong>");
  expect(html).toContain("<table");
  expect(html).toContain("<code>echo</code>");
});
