# Project Gilly - Harnesses

The harness drives one agent loop behind Gilly's stable `harness-protocol` HTTP contract. One
universal server and image contain both compiled implementations: `claude` and `codex`.

## Registry and routing

The SQLite-backed harness registry owns each harness's `id`, `name`, optional root-relative display
`image`, `enabled` state, and offered models. Built-in Claude and Codex definitions are inserted only
when absent, so operator edits survive restart. Provider credentials remain environment variables.

Agent configuration is harness-first:

```json
{
  "harness": {
    "id": "codex",
    "config": { "model": "gpt-5.4", "serviceTier": "fast" }
  }
}
```

The control plane validates the selection against the live registry. `LocalRuntimeProvider` sends
the request unchanged to one `HARNESS_URL`, and the server dispatches only by
`agent.harness.id`. There is no model-name inference or default runner. Model IDs pass to the SDK
unchanged; Codex reads `serviceTier` separately.

Legacy flat model configs are normalized only while being read or migrated. The former
`gpt-5.4-fast` pseudo-model becomes model `gpt-5.4` plus `serviceTier: "fast"`.

## Sessions

Gilly stores the raw harness session ID with the harness ID that owns it. A follow-up resumes only
when that owner matches the agent's current harness. Changing harness starts a fresh harness
conversation while preserving the Gilly Session, workspace, and Run history.

## Claude loop

`apps/harness/src/harness-claude` wraps the Claude Agent SDK. It maps Gilly's `Read`, `Write`, and
`Bash` abstractions to Claude SDK tool names, materializes skills under `.claude/skills`, and
exposes the tooling gateway through an in-process MCP server.

## Codex loop

`apps/harness/src/harness-openai` wraps `@openai/codex-sdk`. It keeps workspace and `CODEX_HOME`
state separate, injects the system prompt as developer instructions, materializes skills under
`.agents/skills`, applies Codex's native sandbox, and translates SDK events to Gilly stream events.

The Codex SDK currently emits completed item snapshots rather than token deltas, so this loop
streams completed messages and tool events rather than synthesizing token events.

## Gateway and persistence

Both loops receive the same run-scoped gateway coordinates and skill bundles. Codex uses a local
stdio MCP bridge for the gateway's `POST /catalog` and `POST /invoke` API. Docker persists shared
workspaces and separate Codex state while keeping one harness service, image, and URL.
