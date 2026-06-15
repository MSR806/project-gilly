# Project Gilly — Control Plane

**The control plane is Gilly itself: the custom server that decides what runs, when, with what access, and where results go. The harness and runtime sit below it; the control plane is the source of truth above them both.**

The harness drives the agent loop and the runtime gives it a box to run in — but neither knows what an *agent* is, what it's allowed to touch, what starts it, or where its output should land. That knowledge lives in the control plane. It is the only layer Gilly fully builds and owns; the layers beneath it are vendor choices kept deliberately replaceable.

---

## The Layering

```text
Control Plane (Gilly)   →  what runs, when, with what access, where results go     [custom server]  ← THIS LAYER
   Harness              →  the agent loop                                           [Claude Agent SDK]
   Runtime              →  the sandbox the harness runs inside                       [AWS Bedrock AgentCore]
```

For each run, the control plane resolves *which agent* with *what configuration*, asks the runtime for a box, hands the harness a workspace + task, and routes the result to a target. See [`harness.md`](harness.md) and [`runtime.md`](runtime.md) for the two layers below.

---

## The Building Blocks

Everything in the control plane is authored configuration that an agent run draws on. Each concept gets its own doc.

**What an agent is made of** — assembled by *referencing* these; nothing is embedded, so a skill or MCP is authored once and reused everywhere:

- [`agent-registry.md`](agent-registry.md) — the catalog of agents (system prompt, model, attached building blocks)
- [`skill-registry.md`](skill-registry.md) — reusable skills an agent can attach
- [`mcp-registry.md`](mcp-registry.md) — MCP servers an agent can be granted

Any agent can act as a **subagent** — when one agent delegates to another, the delegate is just an agent from the same registry. There is no separate subagent registry.

**How work starts and where it lands** — built on connections; a run begins from a channel, a trigger, or the Fleet, and its result optionally lands on a target:

- [`connection.md`](connection.md) — the foundation: identity + secrets for an external system (Slack bot, GitHub, Jira…), reused by the surfaces below
- [`channel.md`](channel.md) — interactive conversational surfaces (Slack, WhatsApp, Telegram, and the default Web chat)
- [`trigger.md`](trigger.md) — one-shot event sources that fire a run (GitHub events, Cron)
- [`fleet.md`](fleet.md) — fan-out launcher: one agent across many repos
- [`target.md`](target.md) — where an agent's final message is delivered (optional)

A run produces a **Session** (and, for Fleet, a batch of them) — created by the system, not authored, so it isn't a building block here.
