---
name: coding-conventions
description: How to write code in this repo (Gilly). Read BEFORE adding or modifying code — covers the three-layer architecture, the replaceable-layer seams (Channel / RuntimeProvider / SkillStore / harness-protocol), the agent/skill storage split, Bun/Biome/Zod/TypeScript conventions, the pure-helper+test pattern, and recipes for adding an agent, a skill, a channel, a runtime provider, or a domain type. Triggers: "add a feature", "add a channel/agent/skill/runtime", "where does X go", "conventions", "how is this repo structured", "coding style".
---

# Writing code in Gilly

Gilly is an internal platform for building AI agents and connecting them to where work happens (Slack, web). This skill is the durable map of *how the code is organized and the conventions to follow* — read it before implementing, then look at the cited canonical files for the exact shape. Design rationale lives in [`docs/`](../../../docs/) (`mvp-scope.md`, `engineering/repo-architecture.md`, `engineering/slack-assistant.md`).

## The one mental model: three replaceable layers

```
Control Plane (Gilly)   what runs, when, with what access, where output goes   ← we own & build this
   Harness              the agent loop (Claude Agent SDK)                        ← vendor, replaceable
   Runtime              the sandbox the harness runs in (AgentCore, local now)   ← vendor, replaceable
```

Only the **control plane** is ours. The harness and runtime are kept behind **stable seams** so they can be swapped without touching anything above. Four seams enforce this — internalize them, because most changes touch one:

| Seam | Where | What crosses it |
| --- | --- | --- |
| **harness-protocol** | `packages/harness-protocol` | control-plane ⇄ harness contract: `InvocationRequest`, `InvocationResult`, `StreamEvent` (Zod schemas) |
| **RuntimeProvider** | `packages/runtime/src/provider.ts` | control-plane → runtime: `invoke` / `invokeStream` / `healthy`. `LocalRuntimeProvider` today; `AgentCoreRuntimeProvider` is a stub |
| **Channel** | `apps/control-plane/src/channels/channel.ts` | inbound surfaces (Slack, Web) → the engine |
| **SkillStore** | `apps/control-plane/src/stores/skill-store.ts` | control-plane → skill registry: `list`/`get`/`detail`/`create`/`update`/`delete`. `LocalSkillStore` (filesystem) today; `S3SkillStore` later |

Interface and implementation live in separate files (the Channel/RuntimeProvider pattern): `skill-store.ts` is the interface, `local-skill-store.ts` the impl. Seams are **never** put in `packages/core` — core is domain *data types* only.

**The engine** (`apps/control-plane/src/engine.ts`) is the heart and is **transport-agnostic** — it owns the Session/Run lifecycle, the one-active-run-per-session guard, and the batch queue. It resolves config through injected lookups (`getAgent` → DB repo, `getSkill` → `SkillStore`), so runtime-created agents/skills work without a restart. Channels translate their native input into the engine and render its output; the engine never imports Slack/HTTP. Keep it that way.

## Monorepo layout

```
apps/
  control-plane/   Gilly server: channels (Slack, Web), engine, management API, SkillStore (stores/), index.ts wiring
  harness-claude/  Claude Agent SDK behind the AgentCore HTTP contract (server.ts: /invocations, /ping, /invocations/stream)
  web/             Next.js UI (App Router) — agent/skill CRUD + SSE chat; talks to the control-plane API
packages/
  core/            domain model — Zod schemas (Agent, Session, Run, Workspace) + skill helpers. Source of truth for types.
  harness-protocol/ the control-plane ⇄ harness contract
  runtime/         RuntimeProvider seam + Local/AgentCore implementations
  db/              SQLite (Drizzle): operational state (sessions, runs, queue) + agent config (agents table) + repo CRUD
config/agents/     *.json agents — upserted into the DB on every boot (syncAgents); files win for whatever they contain, DB-only agents survive
config/skills/     <name>/SKILL.md folders — the LocalSkillStore's backing files
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
Extension points are interfaces with small implementations (`class … implements X` or a `create…()` factory returning the interface). There are **no `extends` hierarchies** and no base classes — don't introduce them. The harness is swapped at the *wire protocol* (harness-protocol), not by subclassing, because it runs in a different process. Examples: `RuntimeProvider` + `LocalRuntimeProvider` (class), `SkillStore` + `LocalSkillStore` (class, interface in a separate file), `Channel` + `createSlackChannel`/`createWebChannel` (factories), `createEngine(...)` (factory returning `{ handle, stream }`).

## Testing

`bun:test`, fully offline, every seam injectable; tests are colocated `*.test.ts` and a new pure helper ships with its test. Inject fakes (no mocking frameworks): fake `RuntimeProvider`, in-memory DB via `createDb(":memory:")`, injected SDK `query`. **Full guide: [`test-conventions`](../test-conventions/SKILL.md)** — the per-seam faking cheat-sheet and test recipes live there.

## Recipes — where things go

- **New agent** → create via the web UI or management API (`POST /api/agents`); it persists to the `agents` table via `@gilly/db` repo fns. `AgentConfig` (`packages/core/src/agent.ts`) is `{ id, name, model, systemPrompt, tools?, skills? }`. `config/agents/*.json` are upserted into the DB on every boot by `syncAgents` (files win for the ids they define; agents created only in the DB survive).
- **New skill** → create via the web UI or management API (`POST /api/skills`) with `{ name, description, content }`; the `SkillStore` composes a `SKILL.md` (YAML frontmatter + body) under `config/skills/<name>/`. The engine ships an agent's attached skills inline to the harness as `SkillBundle`s.
- **Agent tools** are high-level Gilly abstractions — `Read` / `Write` / `Bash` — stored in config. The harness (`apps/harness-claude/src/loop.ts` `expandTools`) maps them to concrete SDK tools (e.g. `Read → Read/Glob/Grep`). **Never surface SDK tool names above the harness**; the UI/DB/API see only the abstractions.
- **New config-store backend** (e.g. S3 skills) → add a class implementing `SkillStore` in `apps/control-plane/src/stores/` (sibling to `local-skill-store.ts`) and swap it in `index.ts`. Nothing above the seam changes.
- **New channel** (Telegram, etc.) → add `apps/control-plane/src/channels/<x>.ts` implementing `Channel`. Write a **pure** translator (native event → `MessageInput`) + test. Drive `engine.handle(...)` for conversational surfaces that need the one-run-per-session queue/batch, or `engine.stream(...)` for request-scoped surfaces (see `web.ts`). Wire it in `apps/control-plane/src/index.ts` (channels start optionally based on config). Don't put session/queue logic in the channel — that's the engine's job.
- **New runtime provider** → add a class in `packages/runtime` implementing `RuntimeProvider` (`invoke`, `invokeStream`, `healthy`); export it from `index.ts`. Nothing above the seam changes.
- **New domain type / field** → Zod schema in `packages/core`.
- **Change the harness contract** → edit `packages/harness-protocol`; update both sides (the harness in `apps/harness-claude`, the consumers via `@gilly/runtime`). The harness HTTP shape (`/invocations`, `/ping`, `/invocations/stream` NDJSON, port 8080) is the AgentCore contract — don't break it.
- **Operational state** (anything per-run/session) → `packages/db` (Drizzle schema + repo fn). Agent config also lives here (`agents` table); skill blobs do **not** — they live behind the `SkillStore` seam.

## Boundaries to respect (MVP scope & invariants)

- **Config storage is split by shape.** Agent config → SQLite (`agents` table + repo CRUD in `@gilly/db`, runtime-mutable via the API). Skill blobs (`SKILL.md` + files) → the `SkillStore` seam (filesystem now, S3 later). Operational state (sessions/runs/queue) → `packages/db`. Connections/secrets → env. The rule isn't "config never in the DB" — it's: structured records in SQLite, blobs behind the store seam.
- **Out of scope right now:** MCP, subagents, triggers (GitHub/Cron), Fleet, real AgentCore cloud, a secrets vault. Don't half-build these into core types; they're deliberately deferred (see `docs/mvp-scope.md`).
- **Env:** each app auto-loads its own `apps/<app>/.env` (Bun, from the app's cwd). Control-plane path defaults resolve against the repo root via `import.meta.dir`, with env overrides (so Docker's absolute paths work) — keep new paths cwd-independent the same way.
- **Side-effect helpers never break the main flow** (e.g. a failed Slack reaction is swallowed and logged, not thrown). Keep that for best-effort UI niceties.
- **The harness loop never throws** — failures come back as an `{ status: "error" }` result / `error` StreamEvent.
