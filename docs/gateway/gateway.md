# Project Gilly — Tooling Gateway

**The gateway is the one door for every external and internal tool call. Credentials live here, access is resolved here, every call is traced here — and agents call tools programmatically, so large data never flows through model context.**

Agents today have only workspace tools (Read/Write/Bash). Connecting services the obvious way — one MCP server per provider, wired straight into the agent — breaks down fast: too many tools with huge schemas bloat every prompt, and chaining tool A's output into tool B forces the model to copy large payloads through its own context. The gateway fixes both: the model sees exactly two tools, and multi-step work runs as code inside the workspace sandbox.

---

## The Layering

```text
Control Plane   →  mints a run-scoped gateway token, passes it in the InvocationRequest
   Harness      →  exposes the gateway to the agent (two MCP tools + env vars)
   Runtime      →  the sandbox where agent-written scripts execute
   Gateway      →  registry + access resolution + credential vault + tracing   [new service: apps/gateway]
```

The gateway is a peer service, not part of the harness. The harness never holds provider credentials; the sandbox never sees them.

![Gateway layers](../diagrams/gateway-layers.svg)

---

## What the Agent Sees: Two Verbs

The gateway is exposed to the model as an MCP server with exactly two tools, regardless of how many connectors exist:

- **`gateway_catalog({ query? })`** — search the tools this caller is allowed to use; returns names, descriptions, and input schemas on demand.
- **`gateway_invoke({ tool, input })`** — run one tool, get the result.

Provider schemas (Amplitude's 50 tools, Meta's parameter sprawl) live in the gateway's registry and enter context only when the agent asks for them.

## Two Lanes for Calling

1. **Direct** — one small lookup: the agent calls `gateway_invoke` and answers. One round-trip.
2. **Script** — chained or heavy calls: the agent writes a TypeScript file in its workspace and runs it with Bash. The script imports `@gilly/gateway-client` (authenticated via `GILLY_GATEWAY_URL` / `GILLY_GATEWAY_TOKEN` env), chains as many tool calls as it needs, and prints only the summary. Raw payloads live and die inside the sandbox.

A skill teaches the agent which lane to pick. Composite capabilities (e.g. "compute CAC" = Meta spend + Branch installs + math) are skills carrying a script — new composite means a new skill file, not a deploy.

![Two lanes](../diagrams/gateway-two-lanes.svg)

![Run sequence](../diagrams/gateway-run-sequence.svg)

---

## Tool Contract

Every tool — external REST, external MCP, or internal service — is defined the same way:

```typescript
defineTool({
  name: "meta.insights",
  description: "Ad spend/installs for an ad account over a date range",
  input: z.object({ accountId: z.string(), since: z.string(), until: z.string() }),
  creds: ["meta_access_token"],            // what the vault must supply
  handler: async (input, ctx) => { ... },  // ctx: { userId, creds, trace }
});
```

A **connector** is a file in `apps/gateway/src/connectors/` grouping one provider's tools (`amplitude.ts`, `branch.ts`, `meta.ts`, or an internal service). How connectors declare transport, auth, and credential scope is locked in [`connectors-and-auth.md`](connectors-and-auth.md). Upstream MCP servers are wrapped: the gateway is the MCP client and re-exposes their tools through the same registry, so the agent-facing surface is uniform. Connectors are compiled into the gateway — no plugin loading, no per-connector packages; git is the version history.

Two small packages carry the contract:

- **`packages/gateway-kit`** — `defineTool`, `ToolContext`, `Connector` (authoring side)
- **`packages/gateway-client`** — typed `catalog()` / `invoke()` fetch wrappers (script side)

---

## Access Resolution

Two levels, intersected when the control plane mints the run token:

- **Agent level** — agent config gains `connectors: ["amplitude", "branch", ...]`: what this agent may touch at all.
- **User level** — a `grants` table (`userId → tool pattern`): what this user may call. Users are auto-provisioned from Slack and granted access by an admin — see [`identity-and-access.md`](identity-and-access.md).

The token is scoped to `{ userId, agentId, grants }`. Both lanes pass through it, so access holds even inside agent-written scripts. Mechanically it is an **opaque token in a DB table** (gateway and control plane share the SQLite) — checked per call, expired when its run completes; no JWT machinery.

Invoke errors form a closed set: `forbidden` (no grant), `not_connected` (admin hasn't configured the provider), `invalid_input` (schema mismatch), `provider_error`, `timeout`. And the direct lane has a **result-size cap (~50KB)**: a larger result is refused with a pointer to the script lane — the cap is what enforces the context discipline, not just the skill's advice.

## Credentials

A `credentials` table in the existing SQLite: `(provider, key, value)` — single tenant, so one credential per provider, configured once by an admin and shared by everyone the grants allow. Values are encrypted at rest with a master key from env (`GILLY_VAULT_KEY`, AES-GCM); losing the key means re-entering credentials, which is acceptable at this scale. The gateway resolves a tool's declared `creds` from the vault at invocation time and injects them into `ctx`. Credentials never appear in tool output, tokens, or the sandbox.

## Tracing

Every invocation writes a `tool_calls` row keyed by `runId`: caller, tool, args, duration, status. Because every call passes the one door, the audit trail is complete by construction.

---

## What We Deliberately Skip

- Per-connector npm packages, dynamic install, plugin lifecycle — connectors are files in one directory.
- A generic auth abstraction — `creds: string[]` covers keys and tokens; OAuth flows get built when a connector actually needs one.
- Named/versioned gateway functions — composites are skills with scripts; promote a hot one later if determinism demands it.
- Its own execution sandbox — the runtime's workspace already is one.

## Build Order

1. `packages/db`: `users`, `grants`, `credentials`, `tool_calls`, gateway-token tables; control plane upserts users from Slack
2. `apps/gateway`: registry + `catalog`/`invoke` routes + token auth
3. Control plane mints token per run → `InvocationRequest`; harness wires MCP server + env
4. First connector end-to-end (Branch — plain REST) + `gateway-client` + the teaching skill
5. Amplitude (MCP wrap), then Meta; admin UI for users/grants/credentials alongside
