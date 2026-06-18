---
name: coding-conventions
description: How to write code in this repo (Gilly). Read BEFORE adding or modifying code — covers the three-layer architecture, the replaceable-layer seams (Channel / RuntimeProvider / harness-protocol), Bun/Biome/Zod/TypeScript conventions, the pure-helper+test pattern, and recipes for adding an agent, a channel, a runtime provider, or a domain type. Triggers: "add a feature", "add a channel/agent/runtime", "where does X go", "conventions", "how is this repo structured", "coding style".
---

# Writing code in Gilly

Gilly is an internal platform for building AI agents and connecting them to where work happens (Slack, web). This skill is the durable map of *how the code is organized and the conventions to follow* — read it before implementing, then look at the cited canonical files for the exact shape. Design rationale lives in [`docs/`](../../../docs/) (`mvp-scope.md`, `engineering/repo-architecture.md`, `engineering/slack-assistant.md`).

## The one mental model: three replaceable layers

```
Control Plane (Gilly)   what runs, when, with what access, where output goes   ← we own & build this
   Harness              the agent loop (Claude Agent SDK)                        ← vendor, replaceable
   Runtime              the sandbox the harness runs in (AgentCore, local now)   ← vendor, replaceable
```

Only the **control plane** is ours. The harness and runtime are kept behind **stable seams** so they can be swapped without touching anything above. Three seams enforce this — internalize them, because most changes touch one:

| Seam | Where | What crosses it |
| --- | --- | --- |
| **harness-protocol** | `packages/harness-protocol` | control-plane ⇄ harness contract: `InvocationRequest`, `InvocationResult`, `StreamEvent` (Zod schemas) |
| **RuntimeProvider** | `packages/runtime/src/provider.ts` | control-plane → runtime: `invoke` / `invokeStream` / `healthy`. `LocalRuntimeProvider` today; `AgentCoreRuntimeProvider` is a stub |
| **Channel** | `apps/control-plane/src/channels/channel.ts` | inbound surfaces (Slack, Web) → the engine |

**The engine** (`apps/control-plane/src/engine.ts`) is the heart and is **transport-agnostic** — it owns the Session/Run lifecycle, the one-active-run-per-session guard, and the batch queue. Channels translate their native input into the engine and render its output; the engine never imports Slack/HTTP. Keep it that way.

## Monorepo layout

```
apps/
  control-plane/   Gilly server: channels (Slack, Web), engine, JSON config loader, index.ts wiring
  harness-claude/  Claude Agent SDK behind the AgentCore HTTP contract (server.ts: /invocations, /ping, /invocations/stream)
  web/             Next.js UI (App Router) — lists agents, SSE chat; talks to the control-plane API
packages/
  core/            domain model — Zod schemas (Agent, Session, Run, Workspace). Source of truth for types.
  harness-protocol/ the control-plane ⇄ harness contract
  runtime/         RuntimeProvider seam + Local/AgentCore implementations
  db/              SQLite (Drizzle) — operational state only (sessions, runs, follow-up queue)
config/agents/     *.json agent definitions, loaded at boot
```

## Conventions (non-negotiable)

- **Bun** is the toolchain: `bun install`, `bun test`, `bun --watch src/index.ts` (no dev build step), native TS. Don't add Node-only build tooling.
- **TypeScript** is strict with `noUncheckedIndexedAccess` + `verbatimModuleSyntax` (see `tsconfig.base.json`). Consequences you must follow:
  - Import internal packages **by name, no extension**: `import { createEngine } from "@gilly/runtime"`.
  - Import local files **with the `.ts` extension**: `import { toBlocks } from "./slack-format.ts"`.
  - Use `import type { … }` for type-only imports.
  - Indexed access is `T | undefined` — handle it.
- **Biome** for lint+format (`bun run biome check .`): 2-space indent, **line width 100**, double quotes, semicolons. Run it before finishing; it will reorganize imports and flag e.g. string-concat (use template literals) and assignment-in-expression.
- **Zod schemas are the source of truth** for domain types. Define the schema in `packages/core`, export the type as `z.infer<typeof X>` (see `packages/core/src/agent.ts`). Validate at boundaries with `.parse` / `.safeParse`.
- **Comments**: minimal but proper — short docstrings only where they earn it. Match the terse surrounding style; don't pad.
- **Verify before done**: `bun run typecheck` (all 7 workspaces exit 0), `bun test` (0 fail), `bun run biome check .` (exit 0). All three.

## Two patterns to copy

**1. Humble object — pure logic out of I/O boundaries, with a colocated test.**
Anything that talks to Slack/HTTP/the SDK stays a thin shell; the real logic is a pure function next to a `*.test.ts`. Canonical examples:
- `apps/control-plane/src/channels/slack-translate.ts` (+ `.test.ts`) — Slack event → engine input.
- `apps/control-plane/src/channels/slack-format.ts` (+ `.test.ts`) — Markdown → Block Kit.
- `apps/harness-claude/src/loop.ts` — `reduceSdkStream` (pure) split from the SDK call; `query` is injected (`runAgentLoop(req, queryFn = query)`) so tests pass a fake.

**2. Seams via interface + composition — never inheritance.**
Extension points are interfaces with small implementations (`class … implements X` or a `create…()` factory returning the interface). There are **no `extends` hierarchies** and no base classes — don't introduce them. The harness is swapped at the *wire protocol* (harness-protocol), not by subclassing, because it runs in a different process. Examples: `RuntimeProvider` + `LocalRuntimeProvider` (class), `Channel` + `createSlackChannel`/`createWebChannel` (factories), `createEngine(...)` (factory returning `{ handle, stream }`).

## Testing

`bun:test`, fully offline, every seam injectable; tests are colocated `*.test.ts` and a new pure helper ships with its test. Inject fakes (no mocking frameworks): fake `RuntimeProvider`, in-memory DB via `createDb(":memory:")`, injected SDK `query`. **Full guide: [`test-conventions`](../test-conventions/SKILL.md)** — the per-seam faking cheat-sheet and test recipes live there.

## Recipes — where things go

- **New agent** → drop a JSON file in `config/agents/` matching the `AgentConfig` schema (`{ id, name, model, systemPrompt }`). No code, no DB, no API. (MVP has no MCP/skills/subagents — don't add fields the schema doesn't have.)
- **New channel** (Telegram, etc.) → add `apps/control-plane/src/channels/<x>.ts` implementing `Channel`. Write a **pure** translator (native event → `MessageInput`) + test. Drive `engine.handle(...)` for conversational surfaces that need the one-run-per-session queue/batch, or `engine.stream(...)` for request-scoped surfaces (see `web.ts`). Wire it in `apps/control-plane/src/index.ts` (channels start optionally based on config). Don't put session/queue logic in the channel — that's the engine's job.
- **New runtime provider** → add a class in `packages/runtime` implementing `RuntimeProvider` (`invoke`, `invokeStream`, `healthy`); export it from `index.ts`. Nothing above the seam changes.
- **New domain type / field** → Zod schema in `packages/core`.
- **Change the harness contract** → edit `packages/harness-protocol`; update both sides (the harness in `apps/harness-claude`, the consumers via `@gilly/runtime`). The harness HTTP shape (`/invocations`, `/ping`, `/invocations/stream` NDJSON, port 8080) is the AgentCore contract — don't break it.
- **Operational state** (anything per-run/session) → `packages/db` (Drizzle schema + repo fn). **Config never goes in the DB** — agents are JSON.

## Boundaries to respect (MVP scope & invariants)

- **Config is files, state is SQLite.** Agents/connections = config (JSON / env). Sessions/runs/queue = `packages/db`. Never mix.
- **Out of scope right now:** MCP, skills, subagents, triggers (GitHub/Cron), Fleet, real AgentCore cloud, a secrets vault. Don't half-build these into core types; they're deliberately deferred (see `docs/mvp-scope.md`).
- **Env:** each app auto-loads its own `apps/<app>/.env` (Bun, from the app's cwd). Control-plane path defaults resolve against the repo root via `import.meta.dir`, with env overrides (so Docker's absolute paths work) — keep new paths cwd-independent the same way.
- **Side-effect helpers never break the main flow** (e.g. a failed Slack reaction is swallowed and logged, not thrown). Keep that for best-effort UI niceties.
- **The harness loop never throws** — failures come back as an `{ status: "error" }` result / `error` StreamEvent.
