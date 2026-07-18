# Project Gilly — Slack Assistant Channel

**Gilly's Slack channel uses Slack's AI *assistant* app surface and also responds to channel `@mention`s.** The assistant panel gives a dedicated side-panel container with suggested prompts, a "thinking…" status, auto-titled threads, and a History tab; `@gilly` in any channel the bot is in starts a run that replies in-thread. Both feed the same engine. Implemented in `apps/control-plane/src/channels/slack.ts`. See [`channel.md`](../control-plane/channel.md).

---

## How it maps to our Channel seam

Bolt's `Assistant` class lines up with `Channel` (native event → engine input + a `reply`):

| Assistant handler | Gilly use |
| --- | --- |
| `threadStarted` | greeting + `setSuggestedPrompts(...)` |
| `userMessage` | `assistantMessageToInput()` → ack reaction → an editable progress container while `engine.stream()` runs → final Markdown reply → done reaction |

The conversation key is `channel:thread_ts`, which maps to a Gilly Session (so follow-ups resume the same harness session). Progress uses ordinary message posts and rate-limited `chat.update` calls, so the same delivery path works in the assistant surface and channel threads.

## UX features

- **Reactions** on the user's message (`apps/control-plane/src/channels/slack.ts`): `eyes` on receipt, `white_check_mark` on done, `warning` on error, `hourglass_flowing_sand` when a message is queued behind an active run (`engine.handle` returns `{ queued }`). Reaction failures are swallowed — never block the reply.
- **Progress container**: the editable message starts as a Block Kit `container` titled `Working…`, with the latest grouped activities inside. The final update collapses it as `Completed` or `Failed` and keeps the answer in a sibling `markdown` block. If the container cannot be posted or updated, delivery falls back to the existing plain Markdown messages so presentation never suppresses the answer.
- **Thread context** (channel mentions): when `@gilly` is mentioned inside a thread, `conversations.replies` is fetched, formatted by `formatTranscript`, and prepended to the request via `withThreadContext` — no protocol change.
- **Rich formatting**: replies are sent as Block Kit `markdown` blocks (`toSlackMessages` in `slack-format.ts`) — standard Markdown, no mrkdwn conversion needed; chunked at the 12k-char block limit. The progress container uses documented `section`, `context`, and `divider` children; the final Markdown stays outside because `markdown` is not a supported container child.

---

## Setup

Connections are created in the web UI (**Connections** page), not via env vars — many can coexist, each bound to an agent. The control plane needs `GILLY_VAULT_KEY` set (it encrypts the tokens at rest). Then, per connection:

1. **New connection** → the page guides you: create the Slack app from the manifest (copy button), Socket Mode, the assistant events + `app_mention`, and scopes for assistant replies, reactions, thread history, channel metadata, and user id lookup.
2. **Install to Workspace**, copy the Bot User OAuth Token (`xoxb-…`) and an App-Level Token with `connections:write` (`xapp-…`) into the form; **Test connection** validates them.
3. Pick the agent to bind, save — the socket starts immediately (no restart). Run the harness (`ANTHROPIC_API_KEY`) + control plane; open Gilly from the Slack top-nav or `@mention` it.

Connections are stored in the `slack_connections` table (tokens vault-encrypted); the `SlackManager` (`apps/control-plane/src/channels/slack-manager.ts`) owns the running Bolt apps and starts/stops them live as the API mutates connections.

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
