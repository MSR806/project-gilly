# Project Gilly — Identity & Access

**Gilly is single-tenant: one deployment, one org, no workspace/tenant column anywhere. Users are auto-provisioned on first contact — a new Slack user who messages an agent simply appears in the `users` table, with whatever metadata Slack gives us. Access is granted per user, by an admin, after the fact.**

See [`gateway.md`](gateway.md) for what grants protect.

---

## Users

A user row is created automatically the first time a Slack identity triggers a run — no signup, no invitation. The control plane upserts on every message, pulling metadata from the Slack API (display name, real name, email if the scope allows, avatar) so an admin can recognize the person later.

```text
users(id, slackUserId UNIQUE, name, meta JSON, isAdmin, createdAt)
```

Slack is the only identity source for now. Other identities (email login, WhatsApp, …) come later — when they do, they become additional lookup columns or a linked-identities table; the `users.id` stays the stable key that grants and traces reference.

## Grants

```text
grants(userId, toolPattern, createdAt)
```

`toolPattern` matches tool names (`gmail.*`, `branch.query`). An agent's `connectors[]` determine its catalog; a user's matching grant patterns determine which catalog tools they may invoke.

**The flow is deliberately admin-mediated.** New user messages an agent → they exist in the DB with a name, but no grants → the agent can discover its connected tools, but invocation returns `user_missing_grant` with instructions to stop and inform the user. The admin finds them in the users list (already there, with their Slack name) and adds grants. No self-service, no approval queue — the org is small enough that a human in the loop *is* the feature.

Admins are marked by `isAdmin` on the user row; the first admin is set manually in the DB. Admin today means: manage users, grants, connectors, and credentials in the web UI, and run the OAuth connect flows.

## Single Tenant

There is no `workspaces` table and no `workspaceId` column on credentials, grants, or traces. "Workspace" in Gilly keeps its existing meaning only — the run's filesystem sandbox. If multi-tenancy is ever needed, it arrives as a column-add migration, not a redesign; nothing in the gateway's shape fights it.
