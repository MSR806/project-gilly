# Project Gilly — Harness

**The harness is the agent framework that drives the agent loop. Gilly's primary harness is the Claude Agent SDK, with ACP (Agent Client Protocol) as the standard protocol path for interchangeable harness implementations.**

Below the control plane sit two layers, and both are pluggable:

- **Harness** — the agent framework / loop. *This doc.* **Default implementation: Claude Agent SDK. Protocol direction: ACP.**
- **Runtime** — the sandbox the harness runs inside. *See `runtime.md`.*

We build one harness and one runtime to start — Claude is the default harness implementation. The architecture keeps the harness swappable via a stable `HarnessDriver` seam inside the harness app, and ACP is the protocol that makes harness processes interchangeable without touching the control plane or runtime.

**Claude-first, not Claude-only. ACP is the protocol path forward.**

---

## The Layering

```text
Control Plane (Gilly)   →  what runs, when, with what access, where results go     [custom server]
   Harness              →  the agent loop — reasoning, tool calls, file edits,
                             MCP, skills, subagents, structured result               [HarnessDriver seam]
   Runtime              →  the sandbox the harness runs inside — FS, shell,
                             network, lifecycle                                       [the runtime]
```

The harness runs **inside** the runtime. The control plane picks a harness + runtime pair per run, the runtime provisions the box, and the harness runs the agent loop within it.

---

## HarnessDriver Seam

Inside `apps/harness-claude/`, the server's HTTP contract (`/invocations`, `/invocations/stream`, `/ping`) is decoupled from the agent loop implementation via the **`HarnessDriver`** interface:

```typescript
interface HarnessDriver {
  readonly name: string;
  invoke(req: InvocationRequest): Promise<InvocationResult>;
  invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent>;
}
```

The server selects a driver at boot based on `HARNESS_DRIVER` env var. The HTTP contract remains unchanged regardless of which driver is active.

### Available Drivers

| Driver | `HARNESS_DRIVER` | Description |
| --- | --- | --- |
| **Claude SDK** | `claude` (default) | Drives the Claude Agent SDK directly. Current default. |
| **ACP** | `acp` | Launches an ACP-compatible agent process over stdio and translates between Gilly's harness-protocol and ACP JSON-RPC. |

### Configuration

```bash
# Default — Claude SDK driver (no extra config needed)
HARNESS_DRIVER=claude

# ACP driver — requires command to the ACP-compatible agent binary
HARNESS_DRIVER=acp
ACP_HARNESS_COMMAND=/path/to/acp-agent
ACP_HARNESS_ARGS=--some-flag --another   # optional, space-separated
```

---

## ACP as the Protocol Direction

The **Agent Client Protocol (ACP)** standardizes communication between clients and coding agents. By adopting ACP as our harness protocol direction, any ACP-compatible agent process (Claude Code, Codex, Cursor Agent, custom agents) can serve as a Gilly harness without changes to the control plane or runtime.

The `AcpHarnessDriver`:
1. Spawns the configured ACP agent process.
2. Connects over stdio using NDJSON streams (the ACP transport).
3. Creates a session and sends prompts using ACP's `session/new` + `session/prompt` lifecycle.
4. Translates ACP `session/update` notifications into Gilly `StreamEvent`s (`token`, `tool`, `done`).
5. Returns a standard `InvocationResult` when the prompt turn completes.

This is a thin adapter/transport layer — no new agent runtime, no business logic duplication.

---

## What a Harness Does

Given a task and a workspace, the harness drives the loop to a result: it reasons and plans, calls tools and MCP servers, reads and edits files, runs shell commands, uses skills, delegates to subagents, works through a test/debug loop, and returns a structured result.

It does **not** provision its own sandbox, hold long-lived credentials, or decide where results go — those belong to the runtime and the control plane, which stays the source of truth for what may run and with what access.

---

## Why Claude Is the Default Harness Implementation

Because Gilly owns the platform layer and the runtime owns the box, the harness only has to be excellent at one thing: driving real work to completion inside a sandbox. The Claude Agent SDK is the strongest harness for exactly that, and especially for **coding work** — reading and editing files, running shell commands, understanding a repository, calling MCP tools, delegating to subagents, and looping until tests pass.

That coding strength is the core of Gilly's highest-value cases — PR review, repo audits, package upgrades, test investigation, Fleet — and it carries over to non-coding agents (analytics, support, incident summaries) when tools and MCPs are scoped right. For an MVP whose first wins are engineering-heavy, the Claude SDK is the obvious default.

---

## Why the Harness Must Stay Replaceable

The Claude Agent SDK's strength is also its boundary: **it is built around Claude.** It is the best harness for coding, but it is not a neutral, any-model runner — you cannot simply point it at a different model family when a future case calls for one.

That is the whole reason the harness is a **replaceable layer** with the `HarnessDriver` seam rather than a fixed part of the platform. Over time Gilly will hit cases the Claude SDK isn't the right tool for — a cheaper model for high-volume simple tasks, a different model family a team prefers, or a workflow some other framework expresses better. When that happens we drop in a different driver — an ACP-compatible agent, the OpenAI Agents SDK behind an ACP adapter — **without touching the control plane, the runtime, or the HTTP contract**.

So the architecture commits to Claude as the default harness implementation while keeping ACP as the standard harness protocol: the control plane talks to the harness through a stable HTTP handoff (`/invocations`, `/invocations/stream`), and inside the harness the `HarnessDriver` seam lets us swap Claude for any ACP-compatible agent. Best harness today, any harness tomorrow.

---

## Why Not the Alternatives (as the harness)

The **OpenAI Agents SDK** is itself model- and provider-agnostic — through adapters like LiteLLM it can drive Claude, Gemini, or other models — which makes it a strong candidate the day we need that model flexibility. It isn't the default today only because it's less proven for the repo- and shell-heavy coding execution where the Claude SDK is strongest. **DeepAgents / LangGraph** brings orchestration and durable state that largely duplicate Gilly's control plane, adding layers an MVP doesn't need. A **custom harness from scratch** is unnecessary work. Each stays available behind the replaceable-harness boundary (potentially via ACP adapters), but none displaces Claude as the default.
