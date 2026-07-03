import type { ToolDef } from "@gilly/gateway-kit";

/** Escape a string for literal use inside a RegExp (everything except our `*` wildcard). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Glob match: `*` → `.*`, anchored. Pure. `branch.*` matches `branch.query`; `echo.ping` is exact. */
export function matchPattern(pattern: string, name: string): boolean {
  const rx = new RegExp(`^${escapeRegex(pattern).replaceAll("\\*", ".*")}$`);
  return rx.test(name);
}

/** True if any grant pattern matches the tool name. */
export function isAllowed(name: string, grants: string[]): boolean {
  return grants.some((g) => matchPattern(g, name));
}

/** Filter a tool list down to those the grants allow. */
export function allowedTools(tools: ToolDef[], grants: string[]): ToolDef[] {
  return tools.filter((t) => isAllowed(t.name, grants));
}
