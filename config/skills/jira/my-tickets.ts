// Fetch Jira tickets assigned to the current user.
// Usage: bun .claude/skills/jira/my-tickets.ts [--status all]
import { invoke } from "@gilly/gateway-client";

const CLOUD_ID = "pratilipi.atlassian.net";

type JsonObject = Record<string, unknown>;
export type TicketRow = {
  key: string;
  summary: string;
  type: string;
  status: string;
  priority: string;
  updated: string;
};

function objectValue(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function nestedName(value: unknown): string {
  const name = objectValue(value)?.name;
  return typeof name === "string" && name ? name : "-";
}

function formattedDate(value: unknown): string {
  if (typeof value !== "string") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Convert the normalized Jira response into safe display rows. */
export function ticketRows(result: unknown): TicketRow[] {
  const issues = objectValue(result)?.issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((issue) => {
    const value = objectValue(issue);
    const fields = objectValue(value?.fields);
    if (!value || !fields || typeof value.key !== "string") return [];

    return [
      {
        key: value.key,
        summary: typeof fields.summary === "string" ? fields.summary.slice(0, 60) : "-",
        type: nestedName(fields.issuetype),
        status: nestedName(fields.status),
        priority: nestedName(fields.priority),
        updated: formattedDate(fields.updated),
      },
    ];
  });
}

/** Render ticket rows without exposing raw provider response fields. */
export function renderTickets(rows: TicketRow[], showAll: boolean): string {
  if (!rows.length) return `No ${showAll ? "" : "open "}Jira tickets found.`;

  const lines = [
    `${"Key".padEnd(12)} ${"Type".padEnd(10)} ${"Status".padEnd(14)} ${"Priority".padEnd(10)} ${"Updated".padEnd(14)} Summary`,
    "-".repeat(100),
    ...rows.map(
      (row) =>
        `${row.key.padEnd(12)} ${row.type.padEnd(10)} ${row.status.padEnd(14)} ${row.priority.padEnd(10)} ${row.updated.padEnd(14)} ${row.summary}`,
    ),
    `Total: ${rows.length} ticket(s)`,
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const statusIndex = process.argv.indexOf("--status");
  const showAll = statusIndex >= 0 && process.argv[statusIndex + 1] === "all";
  const jql = showAll
    ? "assignee = currentUser() ORDER BY updated DESC"
    : "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";

  const result = await invoke("jira.searchJiraIssuesUsingJql", {
    cloudId: CLOUD_ID,
    jql,
    maxResults: 50,
    fields: ["summary", "status", "issuetype", "priority", "updated", "project"],
  });
  console.log(renderTickets(ticketRows(result), showAll));
}

if (import.meta.main) await main();
