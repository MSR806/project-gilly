# Project Gilly — Agent Registry

**The catalog of every agent in Gilly.** An agent is a configured AI worker; the registry is where it's created, edited, and looked up. Sources fire agents, the Fleet runs them, and agents delegate to each other — all resolving back to one entry here. See [`control-plane.md`](control-plane.md).

Gilly ships with **no default agent** — every agent is user-authored. The registry starts empty.

## What makes up an agent

An agent has a **system prompt** and an explicit **harness selection**, plus references to building
blocks from the other registries:

| Piece | What it is |
| --- | --- |
| **System prompt** | The agent's role, scope, and style — *not* the task |
| **Harness** | `{ id, config: { model, serviceTier? } }`; the selected enabled harness must offer the model |
| **Skills** | Reusable capabilities — [`skill-registry.md`](skill-registry.md) |
| **Tools** | Scoped system access; git/repo access is one such grant |
| **Subagents** | Other agents this one may delegate to — just entries in this same registry |

Two things to note: the **system prompt is not the task** — the task arrives as a user message at invocation time (Slack mention, cron, Fleet, direct chat), so one agent handles many tasks. And **any agent can be a subagent** — there's no separate catalog; "subagent" is a role, not a kind.

Harness definitions are data-backed records with a display name, enabled state, and model list.
Provider credentials are deployment environment variables, not registry fields. The management API
exposes the registry for operator edits; agent creation and editing use enabled harnesses and their
offered models.
