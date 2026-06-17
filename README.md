# Project Gilly

Internal platform for building AI agents and connecting them to where work happens.
See [`docs/`](docs/) for the design, [`docs/mvp-scope.md`](docs/mvp-scope.md) for what the
first build covers, and [`docs/engineering/repo-architecture.md`](docs/engineering/repo-architecture.md)
for the code layout.

## Layout

```text
apps/control-plane    Slack (Socket Mode) listener + session/run engine
apps/harness-claude   Claude Agent SDK behind the AgentCore contract (/invocations, /ping)
packages/core         Domain model + Zod schemas
packages/harness-protocol  control-plane ⇄ harness contract
packages/runtime      RuntimeProvider seam (Local now, AgentCore later)
packages/db           SQLite (Drizzle) operational store
config/agents         *.json agent definitions
```

## Develop

```bash
bun install
cp .env.example .env        # fill in ANTHROPIC_API_KEY + Slack tokens
bun run typecheck
bun test

bun run dev:harness         # terminal 1 — harness on :8080
bun run dev:control-plane   # terminal 2 — Slack listener
```

Or run both images together: `docker compose -f docker/compose.yaml up --build`.
