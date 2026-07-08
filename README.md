<div align="center">

# Project Gilly

Open-source platform for building AI agents and connecting them to where work happens.

[![Status](https://img.shields.io/badge/status-active%20development-2ea44f)](#project-status)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh/)

</div>

Gilly is a Bun + TypeScript monorepo for turning reusable agent definitions into
real workflows: Slack conversations, local harness runs, session tracking, and
eventually broader triggers like GitHub, cron, and fleet runs.

The current build is intentionally narrow: prove the agent platform spine end to
end before adding more surfaces.

## Why Gilly Exists

The best AI engineering workflows today often happen in local harnesses like
Claude Code, Codex, and OpenCode. They are flexible, high-quality, and deeply
customizable. Most cloud agent platforms solve automation and deployment, but
they also force teams into one harness, one tool model, and one execution model.

Gilly is built around a different bet: the harness should be replaceable. Teams
should be able to bring the agent harness that works best for the job, connect
their own tools, and run the agent from the surfaces where work already starts.

The first wedge is technical teams running agents from Slack and web workflows.
The broader goal is a platform where non-technical teams can also create agents
for analytics, internal operations, audits, reports, and repetitive workflows
without rebuilding infrastructure each time.

## Project Status

**Active development.** APIs, package boundaries, and docs may change while the
MVP is being built.

The MVP target is one JSON-configured agent, triggered from Slack, routed through
the control plane, executed by a Claude harness, and persisted in SQLite so
thread follow-ups can resume the same session.

## What Gilly Provides

| Area | Today |
| --- | --- |
| Agent config | JSON agent definitions loaded from `config/agents/` |
| Channels | Slack Socket Mode plus a web channel surface in progress |
| Control plane | Session/run engine, follow-up queue, channel translation |
| Harness | Claude Agent SDK behind `/invocations` and `/ping` |
| Runtime | Local HTTP runtime provider with an AgentCore-compatible contract |
| Storage | SQLite operational state via Drizzle |
| Web | Next.js UI for managing agents, skills, connectors, users, and chats |

## Architecture

```text
Slack / Web
   |
   v
apps/control-plane
   |  resolves agent config, sessions, runs
   v
packages/runtime
   |  invokes the selected harness
   v
apps/harness-claude
   |  AgentCore-style HTTP contract
   v
Claude Agent SDK
```

Key boundaries:

- `packages/core` - shared domain model and Zod schemas.
- `packages/harness-protocol` - control-plane to harness request/response contract.
- `packages/runtime` - runtime provider seam; local now, cloud provider later.
- `packages/db` - operational records for sessions, runs, and follow-up queues.
- `apps/gateway` and `packages/gateway-*` - connector gateway pieces.

## Vision

Gilly aims to become the harness-agnostic cloud layer for enterprise agents:
connect any harness, any model, any tool, and trigger agents from Slack, web,
scheduled jobs, GitHub events, or other workflow surfaces.

## Quick Start

Prerequisites:

- [Bun](https://bun.sh/)
- Docker, if you want the one-command stack
- Slack app credentials for the Slack channel
- Anthropic credentials for the Claude harness

Install and check the workspace:

```bash
bun install
bun run typecheck
bun test
```

Create local env files:

```bash
cp apps/harness-claude/.env.example apps/harness-claude/.env
cp apps/control-plane/.env.example apps/control-plane/.env
```

Then run the services you need:

```bash
bun run dev:harness         # harness on :8080
bun run dev:control-plane   # API + Slack listener on :4000
bun run dev:web             # web UI on :3000
```

## Docker

Run the stack with Compose:

```bash
cp apps/harness-claude/.env.example apps/harness-claude/.env

docker compose -f docker/compose.yaml up --build
```

Then open http://localhost:3000.

Each service reads its own `apps/<app>/.env`. Compose only overrides in-network
service hostnames and container paths. Keep `WEB_PORT=4000` in
`apps/control-plane/.env` so the published port matches the web app.

## Repository Map

```text
apps/control-plane       Slack/Web channel handling, sessions, runs
apps/harness-claude      Claude harness behind the AgentCore-style contract
apps/gateway             Connector gateway
apps/web                 Next.js management UI
packages/core            Domain model + Zod schemas
packages/db              SQLite + Drizzle operational store
packages/runtime         Runtime provider interface + local provider
packages/harness-protocol  Control-plane <-> harness contract
packages/gateway-client  Gateway client
packages/gateway-kit     Gateway helpers
config/agents            Agent JSON definitions
config/skills            Seed skills
docs                     Design and engineering notes
docker                   Dockerfiles and compose stack
```

## Docs

- [Project overview](docs/PROJECT_GILLY.md)
- [MVP scope](docs/mvp-scope.md)
- [Repo architecture](docs/engineering/repo-architecture.md)
- [Control plane](docs/control-plane/control-plane.md)
- [Gateway](docs/gateway/gateway.md)
- [Runtime](docs/runtime/runtime.md)

## Contributing

Contributions are welcome while the project is still taking shape. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## License

[MIT](LICENSE)
