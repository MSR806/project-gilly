# Project Gilly — Repo & Code Architecture

**A Bun + TypeScript monorepo.** Two deployable apps (control plane, harness), a set of shared packages that encode the layer boundaries, and two Docker images. See [`mvp-scope.md`](../mvp-scope.md) and [`control-plane/control-plane.md`](../control-plane/control-plane.md).

---

## Layout

```text
project-gilly/
├── apps/
│   ├── control-plane/      # Gilly server: Slack (Socket Mode), session/run engine, config loader  → image #1
│   └── harness-claude/     # Claude Agent SDK behind the AgentCore contract (/invocations, /ping)   → image #2
├── packages/
│   ├── core/               # domain model + Zod schemas: Agent, Connection, Session, Run, Workspace
│   ├── harness-protocol/   # the control-plane ⇄ harness contract (invocation request / result)
│   ├── runtime/            # RuntimeProvider interface + LocalRuntimeProvider (AgentCore provider = stub)
│   └── db/                 # Drizzle schema + SQLite client for operational state
├── config/agents/          # *.json agent definitions, loaded at boot
├── docker/                 # Dockerfile.control-plane, Dockerfile.harness, compose.yaml
└── docs/
```

**The two packages that are the architecture.** The replaceable boundaries from the design docs map to code:

- `runtime/` is the **control plane → runtime** seam — swap `LocalRuntimeProvider` for `AgentCoreRuntimeProvider` and nothing above changes.
- `harness-protocol/` is the **control plane → harness** seam — the payload any harness receives (agent config, user message, resume id, workspace ref) and returns (final text, harness session id, status).

`core/` is the shared domain model. `db/` holds only operational records (Sessions, Runs, follow-up queue) — never agent config, which lives in JSON.

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

**Harness runtime.** We run the Claude Agent SDK under Bun — it spawns the Claude Code CLI as a subprocess, which Bun's Node-compat handles. The `harness-claude` container is the only place that could, *as a contingency*, fall back to a Node base image; because the boundary is the container, that decision leaks nowhere else. Plan of record is Bun everywhere.

---

## Docker — Two Images

- **`Dockerfile.control-plane`** — Bun base. Runs the Slack listener + session engine. Mounts `config/agents` and the SQLite volume.
- **`Dockerfile.harness`** — exposes `/invocations` + `/ping` on `:8080` (AgentCore contract). Bun base, with the Node escape hatch noted above. This is the image that later ships to AgentCore unchanged.
- **`compose.yaml`** — wires `control-plane` → `harness` over the Docker network; `LocalRuntimeProvider` POSTs `http://harness:8080/invocations`.

---

## Testing Strategy

- **Unit** — session/run state machine, thread→Session mapping, follow-up queueing, config loading.
- **Contract** — `harness-protocol` schemas round-trip; control plane tests run against a fake `RuntimeProvider`; harness tests mock the Claude SDK.
- **End-to-end** (optional, flagged) — `compose up` then drive a real invocation through `LocalRuntimeProvider`.

---

## Request Flow

```text
Slack thread message
  → control plane: resolve agent (JSON) + Session (SQLite)
  → RuntimeProvider.invoke(harnessImage, { agentConfig, userMessage, resumeSessionId, workspaceRef })
  → LocalRuntimeProvider POSTs harness /invocations
  → harness runs Claude query() loop → { finalText, harnessSessionId, status }
  → control plane records Run, posts reply to the thread
```

---

## Key Decisions

| Decision | Why |
| --- | --- |
| **Bun** over pnpm+Vitest+tsx | One tool; fast; native TS; built-in test. Runs the Claude Agent SDK directly. |
| **JSON agent config**, no API | MVP needs no authoring surface; agents are files loaded at boot. |
| **SQLite** for operational state | Sessions/Runs must survive restarts (to resume threads) without an extra container. Same Drizzle schema swaps to Postgres later. |
| **Slack Socket Mode** | No public URL/tunnel for local dev. |
| **AgentCore contract from day one** | Same harness image runs locally and (later) in AgentCore; runtime swap is a provider change, not a rewrite. |
| **`runtime/` + `harness-protocol/` as packages** | Makes the design's "replaceable layers" real, enforced boundaries. |
