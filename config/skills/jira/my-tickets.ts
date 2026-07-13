// Fetch Jira tickets assigned to the current user.
// Usage: bun .claude/skills/jira/my-tickets.ts [--status all]
import { invoke } from "@gilly/gateway-client";

const CLOUD_ID = "pratilipi.atlassian.net";
const showAll =
  process.argv.includes("--status") &&
  process.argv[process.argv.indexOf("--status") + 1] === "all";

const jql = showAll
  ? "assignee = currentUser() ORDER BY updated DESC"
  : "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";

const result = (await invoke("jira.searchJiraIssuesUsingJql", {
  cloudId: CLOUD_ID,
  jql,
  maxResults: 50,
  fields: ["summary", "status", "issuetype", "priority", "updated", "project"],
})) as { issues?: Array<{ key: string; fields: Record<string, unknown> }> };
const issues = result.issues ?? [];

if (!issues.length) {
  console.log(`No ${showAll ? "" : "open "}Jira tickets found.`);
  process.exit(0);
}

const rows = issues.map((issue) => {
  const f = issue.fields;
  return {
    key: issue.key,
    summary: (f.summary as string).slice(0, 60),
    type: (f.issuetype as { name: string })?.name ?? "-",
    status: (f.status as { name: string })?.name ?? "-",
    priority: (f.priority as { name: string })?.name ?? "-",
    updated: new Date(f.updated as string).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  };
});

console.log(
  `\n${"Key".padEnd(12)} ${"Type".padEnd(10)} ${"Status".padEnd(14)} ${"Priority".padEnd(10)} ${"Updated".padEnd(14)} Summary`,
);
console.log("-".repeat(100));
for (const r of rows) {
  console.log(
    `${r.key.padEnd(12)} ${r.type.padEnd(10)} ${r.status.padEnd(14)} ${r.priority.padEnd(10)} ${r.updated.padEnd(14)} ${r.summary}`,
  );
}
console.log(`\nTotal: ${issues.length} ticket(s)`);
