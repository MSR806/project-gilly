# Project Gilly — Harness

**The harness is the agent framework that drives the agent loop. Gilly's primary harness is the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).**

Below the control plane sit two layers, and both are pluggable:

- **Harness** — the agent framework / loop. *This doc.* **Decided: Claude Agent SDK.**
- **Runtime** — the sandbox the harness runs inside. *See `runtime.md` (pending).* **Not yet decided.**

We build **one harness and one runtime** to start — Claude is the primary harness. The interfaces stay pluggable so we can add others later, but we are **not** building the full harness × runtime matrix yet.

**Claude-first, not Claude-only.**

---

## The Layering

```text
Control Plane (Gilly)   →  what runs, when, with what access, where results go     [custom server]
   Harness              →  the agent loop — reasoning, tool calls, file edits,
                            MCP, skills, subagents, structured result               [Claude Agent SDK]
   Runtime              →  the sandbox the harness runs inside — FS, shell,
                            secrets, network policy, lifecycle                       [TBD → runtime.md]
```

The harness runs **inside** the runtime. The control plane picks a `(harness, runtime)` pair per run, the runtime provisions the box, and the harness runs the agent loop within it.

---

## What a Harness Does

Given a task and a workspace, the harness drives the loop to a result:

- reasons and plans locally
- calls tools and MCP servers
- reads and edits files
- runs shell / CLI commands
- uses skills
- delegates to subagents
- loops through test/debug
- returns a structured result

It does **not** provision its own sandbox, hold long-lived credentials, or decide where results go — those belong to the runtime and the control plane.

---

## Why Claude Is the Primary Harness

Because Gilly owns the platform layer and the runtime owns the box, the harness only has to be excellent at driving work to completion. Claude is strong at exactly that.

| Capability | Why it matters | Claude |
| --- | --- | --- |
| Agent loop | Core of every run | Strong |
| File read/write | Engineering + docs agents | Strong |
| Shell / CLI | Repo work, tests | Strong |
| MCP integrations | Internal tools & data | Strong |
| Skills | Reusable capabilities | Strong |
| Subagents | Complex, delegated tasks | Strong |
| Repo understanding | Fleet + code agents | Strong |
| Structured output | Result contract | Good — enforced by the Gilly adapter |

It behaves like a programmable agentic worker, which covers Gilly's highest-value cases — PR review, repo audits, package upgrades, test investigation, Fleet — and non-coding agents (analytics, support, incident summaries) when tools and MCPs are scoped right.

---

## The Harness Interface

One neutral interface, so the harness is swappable even while we ship only Claude.

```ts
interface Harness {
  run(input: HarnessInput): Promise<HarnessResult>
}

class ClaudeHarness implements Harness { /* the one we build now */ }

// later, only if a real need forces it:
class OpenAIHarness    implements Harness {}
class DeepAgentsHarness implements Harness {}
```

- **`HarnessInput`** — agent config, task, a **workspace handle from the runtime**, the allowed tools / MCPs / skills / subagents, effective permissions, and an output schema.
- **`HarnessResult`** — status (`succeeded` / `failed` / `needs_approval` / `blocked` / `no_action_needed`), summary, artifacts, proposed changes / PR URL, and run metrics (tokens, tool calls, cost).

The harness reaches the filesystem and shell **through the runtime's workspace handle** — it never boots its own box. The matching `Runtime` interface lives in `runtime.md`.

---

## Harness vs Control Plane

| Gilly control plane | Claude harness (per run) |
| --- | --- |
| Agent registry & versioning | Reasoning inside the run |
| Trigger routing (Slack / GitHub / cron / chat / Fleet) | Local task planning |
| Fleet fan-out & result aggregation | Tool & MCP calls |
| Tool / MCP / skill / subagent registries | File edits |
| RBAC, permissions, approvals (source of truth) | Shell commands (within runtime policy) |
| Run history, audit logs, dashboards | Skill execution & subagent delegation |
| Target publishing, retries, escalation | Test/debug loop → final structured result |

The harness can enforce runtime-level tool permissions, but **Gilly is the source of truth.** Users think in Gilly concepts; the harness stays hidden behind the UI.

---

## Fleet and the Harness

Fleet is **never** one giant Claude agent juggling many repos in one context. It's one control-plane Fleet run that fans out into **many independent harness runs — one per repo/service**, each in its own runtime sandbox. Each child run ends with a clear outcome (`pr_opened`, `completed_no_action`, `blocked`, `failed`, `needs_human_followup`, `pending`, `running`) that the control plane aggregates.

---

## Why Not the Alternatives (as the harness)

| Harness option | Verdict | Reason |
| --- | --- | --- |
| **Claude Agent SDK** | **Primary** | Strong file/shell/MCP/skills/subagents; ideal for repo work & Fleet children; fastest MVP |
| OpenAI Agents SDK | Later, optional | Good OpenAI-native flows, but less aligned with Claude-style repo/shell/Fleet execution |
| DeepAgents / LangGraph | Later, only if needed | Its orchestration & durable state duplicate Gilly's control plane — extra layers for MVP |
| Custom from scratch | Avoid | Too slow, unnecessary |

Because Gilly owns the scheduler, Fleet model, permissions, and routing, the harness only needs to run work well inside a box. That's Claude.

---

## The Short Version

```text
Claude-first, not Claude-only.
Gilly owns the platform.
The harness runs the agent loop.
The runtime is the sandbox it runs in — a separate, pluggable decision (runtime.md).
One harness and one runtime to start; interfaces stay swappable.
Fleet fans out through Gilly into many harness runs, not one giant agent context.
```

---

## Open Questions (harness-scoped)

The final `HarnessInput` / `HarnessResult` schema; how permissions and approvals are surfaced into the loop; how structured output is enforced; how subagents are configured; which specific Claude Agent SDK features (hooks, MCP, skills, subagents) we depend on. *Runtime/sandbox questions move to `runtime.md`.*
