---
name: jira
description: "Use when working with Jira: fetching tickets assigned to the user, searching issues, creating or updating issues, transitioning status, or any Jira/Confluence operation. Load this skill before calling any jira.* gateway tools."
---

# Jira

Reach Jira via the tooling gateway (`jira.*` tools). Always load the `tooling` skill first if the gateway isn't already set up.

## Site
- cloudId: `pratilipi.atlassian.net`

## Fetch my tickets (bundled script)

To get the current user's open Jira tickets, run the bundled script — single gateway call:

```bash
bun .claude/skills/jira/my-tickets.ts
# show all (including Done):
bun .claude/skills/jira/my-tickets.ts --status all
```

## Common JQL patterns

```
# Assigned to current user, not done
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC

# Specific project
project = FR AND assignee = currentUser() AND statusCategory != Done

# By status
status = "In Progress" AND assignee = currentUser()
```

## Key tools

| Tool | When to use |
|------|-------------|
| `jira.searchJiraIssuesUsingJql` | Search/list issues |
| `jira.getJiraIssue` | Get a single issue by key |
| `jira.createJiraIssue` | Create a new issue |
| `jira.editJiraIssue` | Update fields on an issue |
| `jira.transitionJiraIssue` | Change status (get valid IDs with `getTransitionsForJiraIssue`) |
| `jira.addCommentToJiraIssue` | Add a comment |
| `jira.atlassianUserInfo` | Get current user's account ID |
| `jira.lookupJiraAccountId` | Look up another user by name/email |

## Required fields for createJiraIssue
- `cloudId`, `projectKey`, `issueTypeName`, `summary`
- Use `additional_fields` for priority, labels, components, custom fields
