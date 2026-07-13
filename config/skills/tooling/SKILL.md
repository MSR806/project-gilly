---
name: tooling
description: Use whenever a task needs an external service or internal tool (analytics, ad spend, attribution, email, a database, any connector). Explains the tooling gateway — the two tools you have and how to call them cheaply.
---

# External Tools — the Gateway

Every external and internal tool is reached through **one gateway**. You never hold credentials
and you never see a provider's full API. You have exactly two tools:

- **`gateway_catalog({ query? })`** — search the tools you're allowed to use. Returns names,
  descriptions, and input schemas. Call this first to discover what exists; pass a `query` to
  filter (e.g. `"ad spend"`).
- **`gateway_invoke({ tool, input })`** — run one tool by name and get its result.

Tools are named `connector.tool` (e.g. `branch.query`, `echo.ping`). If a tool you expect isn't in
the catalog, you haven't been granted it — tell the user to ask an admin for access; don't try to
work around it.

## Pick the lane

**Direct** — one small lookup. Call `gateway_invoke` and use the result. One round-trip.

```
gateway_invoke({ tool: "branch.query", input: { since: "2026-06-01", until: "2026-06-30" } })
```

The direct lane refuses results larger than ~50KB (you'll get an error pointing you here). Big or
chained work goes in the script lane so raw payloads never fill your context.

**Script** — chained calls, or heavy data you only need to summarize. Write a TypeScript file in
your workspace and run it with Bash. It imports `@gilly/gateway-client`, which is already
authenticated via the `GILLY_GATEWAY_URL` / `GILLY_GATEWAY_TOKEN` env vars in your sandbox. Chain
as many calls as you need and **print only the summary** — the full results live and die inside
the script.

`invoke()` returns the normal tool value (object, array, string, etc.); consume it directly. Before
bundling a script into a skill, run it and verify the output contains the expected data — a zero
exit code alone is not proof that the script is correct.

```ts
// cac.ts — run with: bun cac.ts
import { invoke } from "@gilly/gateway-client";

const spend = await invoke("meta.insights", { accountId: "…", since, until });
const installs = await invoke("branch.query", { since, until });
console.log("CAC:", totalSpend(spend) / countInstalls(installs)); // only the answer leaves the script
```

`catalog(query?)` is also available in scripts if you need to discover tools programmatically.

## Errors

`gateway_invoke` returns one of a closed set of errors — read it and act, don't retry blindly:

- `forbidden` — you aren't granted this tool. Tell the user to ask an admin.
- `not_connected` — the admin hasn't configured this provider's credentials yet. Say so; it's an
  admin task, not something you fix in-conversation.
- `invalid_input` — your `input` didn't match the tool's schema. Re-check the schema from
  `gateway_catalog` and fix it.
- `provider_error` / `timeout` — the upstream service failed. Report it plainly.
