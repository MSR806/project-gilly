# Project Gilly — Session Lifecycle

**A Session is Gilly's durable work context.** It is created by the control plane when work begins, reused for follow-ups, and tracked until the work is complete or abandoned. The runtime provider may also have its own session concept, but that is an implementation detail below Gilly's Session.

Sessions are not authored building blocks like agents, skills, MCPs, channels, or triggers. They are operational records created by the system so Gilly can answer what is running, what happened, what state exists, and where a follow-up should go.

---

## The Layering

Gilly owns the product lifecycle. Runtime providers own the sandbox.

| Layer | Owns |
| --- | --- |
| **Gilly Session** | Conversation/work identity, source mapping, run history, follow-up queue, status |
| **Gilly Run** | One execution attempt inside a Session |
| **Gilly Workspace** | The durable filesystem/workspace reference used by a Session |
| **Harness session** | The agent-loop conversation state, such as a Claude SDK session |
| **Runtime session** | The sandbox provider's execution context, such as an AgentCore runtime session |

The important boundary: **Gilly's Session is the source of truth.** A runtime session ID, harness session ID, mount path, or workspace ID from a provider is stored as metadata on Gilly's records, not exposed as the product model.

---

## Session, Run, Follow-Up, Workspace

| Concept | What it means |
| --- | --- |
| **Session** | The durable context for a conversation or unit of work. A Slack thread, Web chat, GitHub-triggered task, cron task, or Fleet repo item maps to a Session. |
| **Run** | One execution attempt within a Session. A Session can have many Runs over time: initial run, retry, resumed run, or follow-up run. |
| **Follow-up** | New user input attached to an existing Session. If a Run is already active, the follow-up is queued. |
| **Workspace** | The filesystem state associated with the Session. In the MVP this is AgentCore-managed session storage. |

This keeps retrying, resuming, and provider replacement clean. A failed Run does not erase the Session. A new Runtime can be attached to the same Session if the provider allows it. A follow-up creates another Run against the same Session and Workspace.

---

## How Work Starts

Different entry points create Sessions in slightly different ways, but they all end up with the same lifecycle.

**Channels** own continuing conversations. A Slack thread, Telegram chat, WhatsApp chat, or Web conversation maps to one Gilly Session. Follow-ups in that conversation reuse the Session.

**Triggers** are one-shot event sources. A GitHub event or cron fire creates a Session and an initial Run. If the result later needs a human follow-up, that follow-up attaches to the Session through the configured delivery surface or Web UI.

**Fleet** creates a batch, then creates one Session per selected repository or target. Each repo has its own Runs, Workspace, outcome, and follow-up path, while the Fleet batch tracks the group.

---

## Run Lifecycle

A Session can have only one active Run at a time. This is the default concurrency rule because agents may edit files, run commands, hold tool state, or make external changes.

The high-level lifecycle is:

1. Work arrives from a channel, trigger, or Fleet.
2. Gilly resolves the agent configuration, access, and runtime provider.
3. Gilly creates or reuses the Session and Workspace.
4. Gilly starts a Run and leases or resumes a runtime session from the provider.
5. The harness executes inside the runtime using the Workspace.
6. Gilly records events, status, result, artifacts, and delivery outcome.
7. If queued follow-ups exist, Gilly starts the next Run against the same Session.

Runs are durable records. Runtime processes are not. If a runtime dies, times out, or is replaced, Gilly still knows the Session, Run history, queued follow-ups, and Workspace reference.

---

## Follow-Up Rules

Follow-ups are owned by Gilly, not the runtime provider.

The MVP rule is simple: **one active Run per Session, with FIFO follow-up queueing.** If a user sends a follow-up while the agent is still running, Gilly stores it on the Session and processes it after the active Run finishes.

This keeps Slack, Web, triggers, and Fleet consistent. It also avoids two agents writing to the same workspace at the same time.

Later, live Web or voice channels may support richer behavior such as interruption or true streaming input. That should be an optional channel capability, not the default Session model.

---

## Persistence Responsibilities

Gilly persists operational state. The runtime provider persists sandbox state when it supports it.

| State | MVP owner |
| --- | --- |
| Session identity and source mapping | Gilly database |
| Run status, history, result, errors, artifacts | Gilly database |
| Follow-up queue | Gilly database |
| Agent, skill, MCP, channel, trigger configuration | Gilly database |
| Filesystem/workspace state | AgentCore managed session storage |
| Harness conversation state | Harness-specific storage, such as Claude SDK session persistence or AgentCore Memory |
| Long-term external outputs | The target system, such as a PR, issue, Slack thread, report, or artifact store |

For the MVP, Gilly does **not** build its own filesystem snapshot system. If the sandbox provider gives us reliable provider-native persistence, we use it. AgentCore is the first runtime provider, so Workspace persistence is AgentCore managed session storage.

---

## Runtime Provider Boundary

AgentCore is the current runtime provider, not the product model. Gilly should be able to replace it later with Modal, Daytona, E2B, or a self-hosted sandbox without changing what a Session or Run means.

Each runtime provider can expose different capabilities: persistent filesystem, command execution, WebSocket streaming, background tasks, shared storage, or snapshot/export. Gilly should use provider-native capabilities when available and store the provider handle on the Workspace or Run.

For AgentCore, that means reusing the same runtime session and managed session storage mount for follow-up Runs. For another provider, it may mean reusing a workspace ID, container ID, volume, or project environment. Gilly only needs to know which provider owns the Workspace and how to ask that provider to resume it.

Gilly-managed filesystem snapshots can be added later if a provider lacks persistence or if portability becomes a requirement. They are not part of the MVP.

---

## Current MVP Stance

The first implementation should be intentionally narrow:

1. Gilly owns Session, Run, Follow-up, and Workspace records.
2. AgentCore is the only runtime provider.
3. AgentCore managed session storage is the only filesystem persistence path.
4. A Session has one active Run at a time.
5. Follow-ups received during a Run are queued and processed in order.
6. Runtime and harness IDs are stored as provider metadata, not treated as Gilly IDs.

That gives us durable product semantics now and leaves the provider-replacement path open without prematurely building our own sandbox persistence layer.
