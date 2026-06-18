import type { StreamEvent } from "@gilly/runtime";
import { App, Assistant, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { createEngine } from "../engine.ts";
import type { Channel } from "./channel.ts";
import { fallbackText, toBlocks } from "./slack-format.ts";
import {
  assistantMessageToInput,
  formatTranscript,
  mentionEventToInput,
  type SlackMessageFields,
  type ThreadMessage,
} from "./slack-translate.ts";

// Reaction lifecycle on the user's message: queued ⏳ → working 👀 → done ✅ (or ⚠️).
const REACTION = {
  queued: "hourglass_flowing_sand",
  working: "eyes",
  done: "white_check_mark",
  error: "warning",
};

const TASK_ID = "answer";
// Static task_card labels — no rotation; plain agents have no real phases yet.
const STATUS = { working: "Thinking…", done: "Done", error: "Failed" };

/** Add/remove a reaction; never let a reaction failure break the reply. */
async function react(client: WebClient, channel: string, ts: string, name: string, add = true) {
  try {
    if (add) await client.reactions.add({ channel, timestamp: ts, name });
    else await client.reactions.remove({ channel, timestamp: ts, name });
  } catch (e) {
    console.warn(`[slack] reaction ${name} failed:`, String(e));
  }
}

/**
 * Thread messages to feed the agent (best-effort). With `since` (the ts of the
 * agent's last processed message), returns only the delta — what happened in the
 * thread since then — so a resumed session just gets caught up, not re-fed the lot.
 */
async function threadContext(
  client: WebClient,
  channel: string,
  threadTs: string,
  excludeTs: string,
  since?: string,
) {
  try {
    const res = await client.conversations.replies({ channel, ts: threadTs, limit: 50 });
    let messages = (res.messages ?? []) as ThreadMessage[];
    if (since) messages = messages.filter((m) => m.ts && Number(m.ts) > Number(since));
    return formatTranscript(messages, excludeTs);
  } catch (e) {
    console.warn("[slack] conversations.replies failed:", String(e));
    return "";
  }
}

/** Slack channel via the AI assistant surface + channel @mentions (Socket Mode). */
export function createSlackChannel(deps: {
  engine: ReturnType<typeof createEngine>;
  botToken: string;
  appToken: string;
  agentId: string;
  source?: string;
}): Channel {
  const app = new App({
    token: deps.botToken,
    appToken: deps.appToken,
    socketMode: true,
    logLevel: process.env.SLACK_DEBUG ? LogLevel.DEBUG : LogLevel.INFO,
  });

  app.error(async (error) => {
    console.error("[slack] error:", error);
  });

  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
      console.log("[slack] assistant thread started");
      await say("Hi! I'm Gilly. What can I help you with?");
      await setSuggestedPrompts({
        prompts: [
          { title: "Review a PR", message: "Review this pull request: " },
          { title: "Explain code", message: "Explain how this works: " },
        ],
      });
    },
    // Assistant panel: a "Thinking…"→"Done" task_card with the reply streamed alongside it.
    userMessage: async ({ message, client, sayStream, say, setStatus }) => {
      const msg = message as SlackMessageFields;
      const input = assistantMessageToInput(msg, deps.agentId, deps.source);
      console.log(`[slack] assistant message "${input.userMessage}" (${input.sourceKey})`);
      await react(client, msg.channel, msg.ts, REACTION.working);

      const events = deps.engine.stream(input);
      let final = "";
      let errored = false;
      try {
        const stream = sayStream();
        await stream.append({
          chunks: [
            { type: "task_update", id: TASK_ID, title: STATUS.working, status: "in_progress" },
          ],
        });
        for await (const event of events) {
          if (event.type === "token") {
            final += event.text;
            await stream.append({ markdown_text: event.text });
          } else if (event.type === "error") {
            errored = true;
            await stream.append({ markdown_text: `\n\n⚠️ ${event.error}` });
          }
        }
        await stream.append({
          chunks: [
            {
              type: "task_update",
              id: TASK_ID,
              title: errored ? STATUS.error : STATUS.done,
              status: errored ? "error" : "complete",
            },
          ],
        });
        await stream.stop();
      } catch (e) {
        // Streaming/task_card unavailable → degrade to a plain status + Block Kit reply.
        console.warn("[slack] sayStream failed, falling back:", String(e));
        await setStatus("is thinking…");
        for await (const event of events) {
          if (event.type === "token") final += event.text;
          else if (event.type === "error") {
            errored = true;
            final += `\n\n⚠️ ${event.error}`;
          }
        }
        await say({ blocks: toBlocks(final), text: fallbackText(final) });
      }
      await react(client, msg.channel, msg.ts, errored ? REACTION.error : REACTION.done);
    },
  });

  app.assistant(assistant);

  // Per-thread cursor: ts of the last thread message we've fed the agent.
  const lastSeen = new Map<string, string>();

  /** Swap one reaction for another on each of `refs`. */
  const swap = async (
    client: WebClient,
    channel: string,
    refs: string[],
    from: string,
    to: string,
  ) => {
    for (const ts of refs) {
      await react(client, channel, ts, from, false);
      await react(client, channel, ts, to);
    }
  };

  /** Render one run in a channel thread: ⏳→👀, a task_card + streamed reply, then 👀→✅/⚠️. */
  async function streamRunToSlack(
    client: WebClient,
    p: {
      channel: string;
      threadTs: string;
      teamId?: string;
      user?: string;
      refs: string[];
      events: AsyncIterable<StreamEvent>;
    },
  ) {
    await swap(client, p.channel, p.refs, REACTION.queued, REACTION.working);
    let final = "";
    let errored = false;
    try {
      const stream = client.chatStream({
        channel: p.channel,
        thread_ts: p.threadTs,
        recipient_team_id: p.teamId,
        recipient_user_id: p.user,
      });
      await stream.append({
        chunks: [
          { type: "task_update", id: TASK_ID, title: STATUS.working, status: "in_progress" },
        ],
      });
      for await (const ev of p.events) {
        if (ev.type === "token") {
          final += ev.text;
          await stream.append({ markdown_text: ev.text });
        } else if (ev.type === "error") {
          errored = true;
          await stream.append({ markdown_text: `\n\n⚠️ ${ev.error}` });
        }
      }
      await stream.append({
        chunks: [
          {
            type: "task_update",
            id: TASK_ID,
            title: errored ? STATUS.error : STATUS.done,
            status: errored ? "error" : "complete",
          },
        ],
      });
      await stream.stop();
    } catch (e) {
      console.warn("[slack] mention stream failed, falling back to postMessage:", String(e));
      for await (const ev of p.events) {
        // Finish consuming so the Run is recorded even on the fallback path.
        if (ev.type === "token") final += ev.text;
        else if (ev.type === "error") {
          errored = true;
          final += `\n\n⚠️ ${ev.error}`;
        }
      }
      await client.chat
        .postMessage({
          channel: p.channel,
          thread_ts: p.threadTs,
          blocks: toBlocks(final),
          text: fallbackText(final),
        })
        .catch((err) => console.warn("[slack] fallback postMessage failed:", String(err)));
    }
    await swap(
      client,
      p.channel,
      p.refs,
      REACTION.working,
      errored ? REACTION.error : REACTION.done,
    );
  }

  // Channel mentions: delta thread context, task_card + streamed reply, queued ⏳ → 👀 → ✅.
  app.event("app_mention", async ({ event, client, context }) => {
    const ev = event as SlackMessageFields;
    const user = (event as { user?: string }).user;
    const base = mentionEventToInput(ev, deps.agentId, deps.source);
    const threadTs = ev.thread_ts ?? ev.ts;
    console.log(`[slack] mention "${base.userMessage}" (${base.sourceKey})`);

    // Inside a thread: only what's new since our last turn (full thread on the first).
    const transcript = ev.thread_ts
      ? await threadContext(client, ev.channel, ev.thread_ts, ev.ts, lastSeen.get(base.sourceKey))
      : "";

    const { queued } = await deps.engine.handle({
      ...base,
      context: transcript || undefined,
      ref: ev.ts,
      run: ({ refs, events }) =>
        streamRunToSlack(client, {
          channel: ev.channel,
          threadTs,
          teamId: context.teamId,
          user,
          refs,
          events,
        }),
    });

    if (queued) await react(client, ev.channel, ev.ts, REACTION.queued);
    else lastSeen.set(base.sourceKey, ev.ts);
    console.log("[slack] mention handled", { queued });
  });

  return { name: "slack", start: () => app.start().then(() => {}) };
}
