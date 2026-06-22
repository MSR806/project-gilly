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

# Per-app env — each app auto-loads its own .env:
cp apps/harness-claude/.env.example  apps/harness-claude/.env   # ANTHROPIC_API_KEY
cp apps/control-plane/.env.example   apps/control-plane/.env    # Slack tokens (optional)

bun run typecheck
bun test

bun run dev:harness         # terminal 1 — harness on :8080
bun run dev:control-plane   # terminal 2 — web API on :4000 (+ Slack if configured)
```

## Docker (one command)

Run the whole stack — harness, control-plane, and web — with one command instead
of three terminals. Each service reads its **own** `apps/<app>/.env`; compose only
overrides the in-network bits (service hostnames, container paths):

```bash
cp apps/harness-claude/.env.example apps/harness-claude/.env  # set ANTHROPIC_API_KEY
# apps/control-plane/.env holds Slack tokens, WEB_PORT, etc. (optional)

docker compose -f docker/compose.yaml up --build
```

Then open the UI at http://localhost:3000 (web → control-plane `:4000` → harness `:8080`).
`WEB_PORT` in `apps/control-plane/.env` must stay `4000` to match the published port.
