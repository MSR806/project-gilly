# Project Gilly — Harness

**The harness is the agent framework that drives the agent loop. Gilly uses ACP (Agent Client Protocol) as the harness protocol direction, with Claude Agent SDK as the default MVP driver.**

Below the control plane sit two layers, and both are pluggable:

- **Harness** — the agent framework / loop. *This doc.* **Default driver: Claude Agent SDK. Protocol direction: ACP.**
- **Runtime** — the sandbox the harness runs inside. *See `runtime.md`.*

The harness app (`apps/harness-claude`) exposes the AgentCore HTTP contract (`/invocations`, `/invocations/stream`, `/ping`) and internally delegates to a **HarnessDriver**. Drivers are selected via the `HARNESS_DRIVER` env var:

| Driver | `HARNESS_DRIVER` | Description |
| --- | --- | --- |
| **Claude** (default) | `claude` | Claude Agent SDK loop — the proven MVP path for coding agents. |
| **ACP** | `acp` | Spawns an ACP-compatible agent process over stdio JSON-RPC. Protocol-agnostic — any agent implementing the ACP wire format works. |

**Claude-first, ACP as protocol direction, not Claude-only.**

---

## The Layering

```text
Control Plane (Gilly)   →  what runs, when, with what access, where results go     [custom server]
   Harness              →  the agent loop — reasoning, tool calls, file edits,
                            MCP, skills, subagents, structured result               [Claude Agent SDK]
   Runtime              →  the sandbox the harness runs inside — FS, shell,
                            network, lifecycle                                       [the runtime]
```

The harness runs **inside** the runtime. The control plane picks a harness + runtime pair per run, the runtime provisions the box, and the harness runs the agent loop within it.

---

## What a Harness Does

Given a task and a workspace, the harness drives the loop to a result: it reasons and plans, calls tools and MCP servers, reads and edits files, runs shell commands, uses skills, delegates to subagents, works through a test/debug loop, and returns a structured result.

It does **not** provision its own sandbox, hold long-lived credentials, or decide where results go — those belong to the runtime and the control plane, which stays the source of truth for what may run and with what access.

---

## Why Claude Is the Primary Harness

Because Gilly owns the platform layer and the runtime owns the box, the harness only has to be excellent at one thing: driving real work to completion inside a sandbox. The Claude Agent SDK is the strongest harness for exactly that, and especially for **coding work** — reading and editing files, running shell commands, understanding a repository, calling MCP tools, delegating to subagents, and looping until tests pass.

That coding strength is the core of Gilly's highest-value cases — PR review, repo audits, package upgrades, test investigation, Fleet — and it carries over to non-coding agents (analytics, support, incident summaries) when tools and MCPs are scoped right. For an MVP whose first wins are engineering-heavy, the Claude SDK is the obvious default.

---

## Why the Harness Must Stay Replaceable

The Claude Agent SDK's strength is also its boundary: **it is built around Claude.** It is the best harness for coding, but it is not a neutral, any-model runner — you cannot simply point it at a different model family when a future case calls for one.

That is the whole reason the harness is a **replaceable layer** rather than a fixed part of the platform. Over time Gilly will hit cases the Claude SDK isn't the right tool for — a cheaper model for high-volume simple tasks, a different model family a team prefers, or a workflow some other framework expresses better. When that happens we should be able to drop in a different harness — a model-agnostic one like the OpenAI Agents SDK, say — **without touching the control plane or the runtime**.

So the architecture commits to Claude as the default harness while keeping the harness boundary clean: the control plane talks to a harness through a stable handoff, the harness receives a workspace from the runtime, and nothing above or below it depends on which harness is running. Best harness today, swappable tomorrow.

---

## Why Not the Alternatives (as the harness)

The **OpenAI Agents SDK** is itself model- and provider-agnostic — through adapters like LiteLLM it can drive Claude, Gemini, or other models — which makes it a strong candidate the day we need that model flexibility. It isn't the default today only because it's less proven for the repo- and shell-heavy coding execution where the Claude SDK is strongest. **DeepAgents / LangGraph** brings orchestration and durable state that largely duplicate Gilly's control plane, adding layers an MVP doesn't need. A **custom harness from scratch** is unnecessary work. Each stays available behind the replaceable-harness boundary, but none displaces Claude as the default.

---

## ACP — The Protocol Direction

**ACP (Agent Client Protocol)** is the protocol-level direction for Gilly's harness layer. Rather than writing one bespoke adapter per agent framework, the ACP driver communicates with any agent process that speaks ACP's stdio JSON-RPC wire format.

### How ACP fits

```text
Control Plane → AgentCore HTTP → HarnessDriver → ACP stdio JSON-RPC → agent process
```

The AgentCore HTTP wrapper (`/invocations`, `/ping`, `/invocations/stream`) stays as the runtime ingress — unchanged. Inside the harness app, the `HarnessDriver` interface dispatches to either the Claude SDK or an ACP-compatible subprocess.

### ACP wire format (stdio JSON-RPC)

The ACP driver follows the standard ACP session flow. All messages are newline-delimited JSON-RPC 2.0 on stdin/stdout:

**1. Initialize** — handshake with protocol version and capabilities:

```json
→ { "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": 1, "clientCapabilities": {}, "clientInfo": { "name": "gilly-harness", "version": "1.0.0" } } }
← { "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": 1, "agentCapabilities": { "sessionCapabilities": { "resume": true } } } }
```

**2. Session** — create or restore a session:

```json
→ { "jsonrpc": "2.0", "id": 2, "method": "session/new", "params": { "cwd": "/workspace", "mcpServers": [] } }
← { "jsonrpc": "2.0", "id": 2, "result": { "sessionId": "sess-123" } }
```

Or resume an existing session (if `agentCapabilities.sessionCapabilities.resume`):

```json
→ { "jsonrpc": "2.0", "id": 2, "method": "session/resume", "params": { "sessionId": "sess-123", "cwd": "/workspace", "mcpServers": [] } }
```

Or load a session (if `agentCapabilities.loadSession`):

```json
→ { "jsonrpc": "2.0", "id": 2, "method": "session/load", "params": { "sessionId": "sess-123", "cwd": "/workspace", "mcpServers": [] } }
```

**3. Prompt** — send the user message and stream updates:

```json
→ { "jsonrpc": "2.0", "id": 3, "method": "session/prompt", "params": { "sessionId": "sess-123", "prompt": [{ "type": "text", "text": "hello world" }] } }
← { "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "sess-123", "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "partial" } } } }
← { "jsonrpc": "2.0", "method": "session/update", "params": { "sessionId": "sess-123", "update": { "sessionUpdate": "tool_call", "title": "Read", "kind": "file", "status": "running" } } }
← { "jsonrpc": "2.0", "id": 3, "result": { "stopReason": "end_turn" } }
```

### Configuration

```bash
HARNESS_DRIVER=acp    # select the ACP driver
ACP_COMMAND=my-agent  # the command to spawn
ACP_ARGS=--verbose    # optional space-separated args
```

### What ACP does NOT cover in the MVP

- No MCP tool registry or dynamic tool negotiation.
- No permission prompts or interactive UI approval.
- Session resume is passed as `sessionId` — it's up to the agent process to persist/restore state.
- Cancellation is process-level (kill the subprocess).
