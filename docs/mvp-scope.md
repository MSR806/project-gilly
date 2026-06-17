# Project Gilly — MVP Scope

**The first build: one plain agent, a Claude harness, a local runtime, triggered from Slack.** Deliberately narrow — prove the three-layer spine end to end before adding registries.

---

## In Scope

| Area | MVP behaviour |
| --- | --- |
| **Agent** | System prompt + model only. Authored as **JSON config files**, loaded at boot. No MCP, no skills, no subagents, no CRUD API. |
| **Connection** | One type — a Slack bot. Token supplied via `.env`, not a secrets vault. |
| **Channel** | Slack via the **AI assistant surface** (Socket Mode, no public URL): the assistant panel maps a thread → run → reply, with a "thinking…" status. See [`engineering/slack-assistant.md`](engineering/slack-assistant.md). |
| **Session / Run** | Gilly owns Session, Run, Workspace, follow-up queue. One active Run per Session; follow-ups FIFO-queued. Stored in **SQLite**. |
| **Harness** | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), packaged as a container that speaks the **AgentCore runtime contract** (`POST /invocations`, `GET /ping` on `:8080`). |
| **Runtime** | The harness container run **locally over HTTP** — same contract as AgentCore. `LocalRuntimeProvider` in the control plane invokes it directly. |

---

## Out of Scope (deferred)

- MCP registry, skill registry, subagents.
- Triggers (GitHub, Cron) and Fleet fan-out.
- Web channel and the configuration/monitoring UI.
- Real AgentCore cloud deployment (the contract is honoured now; the AWS provider comes later).
- Secrets vault — `.env` only for the MVP.
- Multiple harnesses / multiple runtimes.

---

## The One Bet That Shapes Everything

The harness implements the **AgentCore HTTP contract from day one**. AgentCore is framework-agnostic — any container exposing `/invocations` + `/ping` on `:8080` runs in it. So locally we just POST to that container; going to real AgentCore later means **pushing the same image and swapping the runtime provider** — no code change in the harness or control plane. This is how "runtime stays replaceable" is kept real instead of aspirational.

---

## Done When

A user `@mention`s the agent in a Slack thread, the control plane resolves the JSON-configured agent, leases the local harness, the Claude loop runs, and the final message lands back in the thread — with a follow-up in the same thread resuming the same Session.
