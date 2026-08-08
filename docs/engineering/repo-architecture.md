# Project Gilly — Repo & Code Architecture

**A Bun + TypeScript monorepo.** Deployable control-plane, harness, gateway, and web apps share packages that encode the layer boundaries. See [`mvp-scope.md`](../mvp-scope.md) and [`control-plane/control-plane.md`](../control-plane/control-plane.md).

---

## Layout

```text
project-gilly/
├── apps/
│   ├── control-plane/      # Gilly server: channels, session/run engine, management API
│   ├── harness/            # One AgentCore server with Claude and OpenAI loops
│   ├── gateway/            # Canonical custom/Composio tool and control-plane gateway
│   └── web/                # Next.js management UI and web chat
├── packages/
│   ├── core/               # schemas: Agent, Harness, Connection, Session, Run, Workspace
│   ├── harness-protocol/   # the control-plane ⇄ harness contract (invocation request / result)
│   ├── runtime/            # RuntimeProvider + LocalRuntimeProvider (AgentCore provider planned)
│   └── db/                 # Drizzle schema + SQLite client for registries and operational state
├── config/agents/          # *.json seed agent definitions, upserted at boot
├── docker/                 # Dockerfile.control-plane, Dockerfile.harness, compose.yaml
└── docs/
```

**The two packages that are the architecture.** The replaceable boundaries from the design docs map to code:

- `runtime/` is the **control plane → runtime** seam — swap `LocalRuntimeProvider` for `AgentCoreRuntimeProvider` and nothing above changes.
- `harness-protocol/` is the **control plane → harness** seam — the payload any harness receives (agent config, user message, resume id, workspace ref) and returns (final text, harness session id, status).

`core/` is the shared domain model. `db/` holds structured agent and harness registry records plus
operational Sessions, Runs, and follow-ups. JSON files under `config/agents/` seed selected agents
at boot and remain authoritative for those ids. The universal harness registry keeps harness
availability and model catalogs runtime-editable while agents select a harness explicitly.

`apps/gateway` is the canonical provider-neutral tool boundary. Exact dotted `gatewayTools` names
from built-in connectors and connected Composio toolkits share one catalog, grant, auth, and trace
path; Composio owns downstream provider credentials while Gilly enforces agent and user access.

A third seam lives inside the control plane: the **`Channel` interface** (`apps/control-plane/src/channels/channel.ts`) is the named inbound surface. Slack conforms to it today; Web/Telegram are future implementations, each translating its native event into the engine's input — interface + composition, no inheritance.

---

## Toolchain — Bun

One tool covers package management, workspaces, test, and TS execution.

| Concern | Choice |
| --- | --- |
| Package manager + workspaces | **Bun** (`bun install`, workspaces in root `package.json`) |
| Run / dev | **Bun** native TS — `bun run`, `bun --watch`; no build step in dev |
| Test | **`bun test`** (built-in, Jest-style) |
| Schemas / validation | **Zod** — single source of types across the boundaries |
| Control-plane HTTP | **Fastify** (health, future webhooks) |
| Slack | **`@slack/bolt`** in Socket Mode |
| Operational store | **SQLite + Drizzle** |
| Lint / format | **Biome** (single fast tool) |

**Harness runtime.** Both SDKs run under Bun in one container and spawn their vendor CLI
subprocesses behind the same HTTP contract.

---

## Docker

- **`Dockerfile.control-plane`** — Bun base. Runs the Slack listener + session engine. Mounts `config/agents` and the SQLite volume.
- **`Dockerfile.harness`** - unified harness on `:8080`, including a native Codex CLI resolution
  check.
- **`Dockerfile.gateway`** - connector and control-plane tool gateway on `:4100`.
- **`Dockerfile.web`** - Next.js management UI on `:3000`.
- **`compose.yaml`** - wires one harness URL to `LocalRuntimeProvider`, with persistent shared
  workspaces and separate Codex session state.

---

## Testing Strategy

- **Unit** — session/run state machine, thread→Session mapping, follow-up queueing, config loading.
- **Contract** — `harness-protocol` schemas round-trip; control plane tests use fake runtime providers; harness tests inject fake SDK streams.
- **End-to-end** (optional, flagged) — `compose up` then drive a real invocation through `LocalRuntimeProvider`.

---

## Request Flow

```text
Slack thread message
  → control plane: resolve agent + harness registry selection + Session (SQLite)
  → RuntimeProvider.invoke({ agentConfig, userMessage, resumeSessionId, workspaceRef })
  → LocalRuntimeProvider POSTs the explicit request to the universal harness /invocations
  → harness selects its Claude or Codex loop from agent.harness.id
  → control plane records Run, posts reply to the thread
```

---

## Key Decisions

| Decision | Why |
| --- | --- |
| **Bun** over pnpm+Vitest+tsx | One tool; fast; native TS; built-in test. Runs both harness SDKs directly. |
| **SQLite registries** | Agent and harness definitions are runtime-editable; bootstrap files and built-ins use idempotent upserts/inserts. |
| **SQLite** for operational state | Sessions/Runs must survive restarts (to resume threads) without an extra container. Same Drizzle schema swaps to Postgres later. |
| **Canonical tooling gateway** | Custom and Composio tools use one dotted-name catalog and one Gilly-owned authorization boundary. |
| **Slack Socket Mode** | No public URL/tunnel for local dev. |
| **AgentCore contract from day one** | Same harness image runs locally and (later) in AgentCore; runtime swap is a provider change, not a rewrite. |
| **`runtime/` + `harness-protocol/` as packages** | Makes the design's "replaceable layers" real, enforced boundaries. |
