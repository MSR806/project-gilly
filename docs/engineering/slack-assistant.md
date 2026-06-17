# Project Gilly — Slack Assistant Channel

**Gilly's Slack channel uses Slack's AI *assistant* app surface and also responds to channel `@mention`s.** The assistant panel gives a dedicated side-panel container with suggested prompts, a "thinking…" status, auto-titled threads, and a History tab; `@gilly` in any channel the bot is in starts a run that replies in-thread. Both feed the same engine. Implemented in `apps/control-plane/src/channels/slack.ts`. See [`channel.md`](../control-plane/channel.md).

---

## How it maps to our Channel seam

Bolt's `Assistant` class lines up with `Channel` (native event → engine input + a `reply`):

| Assistant handler | Gilly use |
| --- | --- |
| `threadStarted` | greeting + `setSuggestedPrompts(...)` |
| `userMessage` | `message` → `assistantMessageToInput()`; then `setStatus("is thinking…")` → `engine.handle(...)` → `say(finalText)` |

`setStatus` auto-clears when we `say`. The conversation key is `channel:thread_ts`, which maps to a Gilly Session (so follow-ups resume the same harness session) — we don't need Slack's thread-context store for that.

---

## Setup

Create the app from [`docs/slack-app-manifest.yaml`](../slack-app-manifest.yaml). It enables the assistant view, Socket Mode, the three assistant events, and scopes `assistant:write` + `chat:write` + `im:history`. Then:

1. **App-Level Token** with `connections:write` → `SLACK_APP_TOKEN` (`xapp-…`).
2. **Install to Workspace**, copy Bot User OAuth Token → `SLACK_BOT_TOKEN` (`xoxb-…`).
3. Run the harness (`ANTHROPIC_API_KEY`) + control plane; open Gilly from the Slack top-nav and chat.

---

## Requirements & caveats

- **Paid Slack plan** required to use AI apps; **guests** can't access them.
- **Internal app only** — the `assistant:write` scope restricts Marketplace publishing to partners, but internal workspace apps need no approval (this is us).
- **Socket Mode is supported** (Slack recommends HTTP for production, not required).
- Status **times out ~2 min** — long runs should re-`setStatus`; `message.im` follow-ups don't carry thread context (persist it); use Slack `mrkdwn`, not standard markdown.
- The `assistant:write` ↔ `chat:write` scope acceptance was in flux (Mar 2026 changelog) — keep both.

---

## Adjacent, not used

- **Slack MCP Server / Real-Time Search API** — a sanctioned *tool* for agents to read/search Slack data; consume later if needed, orthogonal to this channel.
- **Salesforce Agentforce** — a managed no-code agent product; not our build path.

Sources: [AI in Slack](https://docs.slack.dev/ai/), [Developing an agent](https://docs.slack.dev/ai/developing-agents/), [Bolt-JS Assistant class](https://docs.slack.dev/tools/bolt-js/concepts/using-the-assistant-class/), [Understand AI apps in Slack](https://slack.com/help/articles/33076000248851-Understand-AI-apps-in-Slack).
