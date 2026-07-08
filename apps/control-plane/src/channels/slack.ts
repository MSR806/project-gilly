import { type Db, upsertUserBySlackId } from "@gilly/db";
import type { StreamEvent } from "@gilly/runtime";
import { App, Assistant, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { createEngine } from "../engine.ts";
import {
  advanceSteps,
  closeSteps,
  fallbackText,
  newStepState,
  PLAN,
  toBlocks,
} from "./slack-format.ts";
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

/** A Slack streaming message handle (from `client.chatStream(...)` or `sayStream()`). */
type SlackStream = ReturnType<WebClient["chatStream"]>;

/** Reduce a run's events to just the final answer + error flag (for the non-streaming fallback). */
async function drainToFinal(
  events: AsyncIterable<StreamEvent>,
): Promise<{ final: string; errored: boolean }> {
  let tokens = "";
  let finalText: string | null = null;
  let errored = false;
  for await (const ev of events) {
    if (ev.type === "token") tokens += ev.text;
    else if (ev.type === "done") finalText = ev.finalText;
    else if (ev.type === "error") {
      errored = true;
      tokens += `\n\n⚠️ ${ev.error}`;
    }
  }
  return { final: (finalText ?? tokens).trim(), errored };
}

/**
 * Consume one run's events into a Slack streaming message. Progress renders as a plan block:
 * a "Working…"→"Done"/"Failed" header with one `task_update` step per tool call / intermediate
 * assistant message. Only the final answer (`done.finalText`) becomes the message body — live
 * token deltas drive nothing (they can't be split into intermediate-vs-final mid-stream).
 * Returns the final answer + error flag.
 */
async function pumpRunToStream(
  stream: SlackStream,
  events: AsyncIterable<StreamEvent>,
): Promise<{ final: string; errored: boolean }> {
  let tokens = "";
  let finalText: string | null = null;
  let errored = false;
  let steps = newStepState();

  await stream.append({ chunks: [{ type: "plan_update", title: PLAN.working }] });
  for await (const ev of events) {
    if (ev.type === "token") {
      tokens += ev.text; // fallback body if `done` never carries finalText; not streamed live
    } else if (ev.type === "tool" || ev.type === "message") {
      const next = advanceSteps(steps, ev);
      steps = next.state;
      if (next.chunks.length) await stream.append({ chunks: next.chunks });
    } else if (ev.type === "done") {
      finalText = ev.finalText;
    } else if (ev.type === "error") {
      errored = true;
      tokens += `\n\n⚠️ ${ev.error}`;
    }
  }

  await stream.append({
    chunks: [
      ...closeSteps(steps, errored),
      { type: "plan_update", title: errored ? PLAN.error : PLAN.done },
    ],
  });
  const final = (finalText ?? tokens).trim();
  if (final) await stream.append({ markdown_text: final });
  return { final, errored };
}

/** Add/remove a reaction; never let a reaction failure break the reply. */
async function react(client: WebClient, channel: string, ts: string, name: string, add = true) {
  try {
    if (add) await client.reactions.add({ channel, timestamp: ts, name });
    else await client.reactions.remove({ channel, timestamp: ts, name });
  } catch (e) {
    // Removing a reaction that was never added (e.g. an inline run that skipped ⏳) is expected.
    if (!add && String(e).includes("no_reaction")) return;
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

/**
 * Resolve a Slack user id to our internal user id (upsert on first contact). Best-effort:
 * a failed users.info still upserts with the id as the name — never blocks the run.
 */
async function resolveUserId(
  client: WebClient,
  db: Db,
  slackUserId?: string,
): Promise<string | undefined> {
  if (!slackUserId) return undefined;
  const info = await client.users.info({ user: slackUserId }).catch(() => undefined);
  const u = info?.user;
  const name = u?.real_name || u?.name || slackUserId;
  const meta = u?.profile as Record<string, unknown> | undefined;
  return upsertUserBySlackId(db, { slackUserId, name, meta }).id;
}

function logSlackReceived(
  kind: "assistant_message" | "mention",
  input: { sourceKey: string; userMessage: string },
  message: SlackMessageFields,
  extra: Record<string, unknown> = {},
) {
  console.log(
    `[slack] received ${JSON.stringify({
      kind,
      userId: message.user ?? null,
      teamId: message.team ?? null,
      channel: message.channel,
      channelType: message.channel_type ?? null,
      ts: message.ts,
      threadTs: message.thread_ts ?? message.ts,
      sourceKey: input.sourceKey,
      text: input.userMessage,
      ...extra,
    })}`,
  );
}

/**
 * Build a Bolt Socket-Mode app for one Slack connection: the AI assistant surface + channel
 * @mentions, both routing to `deps.agentId`. Returns the unstarted `App`; the connection manager
 * owns its start/stop lifecycle.
 */
export function buildSlackApp(deps: {
  engine: ReturnType<typeof createEngine>;
  db: Db;
  botToken: string;
  appToken: string;
  agentId: string;
  source?: string;
}): App {
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
    // Assistant panel: a "Working…"→"Done" plan block (one step per tool/intermediate message),
    // then the final answer as the message body.
    userMessage: async ({ message, client, sayStream, say, setStatus }) => {
      const msg = message as SlackMessageFields;
      const userId = await resolveUserId(client, deps.db, msg.user);
      const input = assistantMessageToInput(msg, deps.agentId, deps.source, userId);
      logSlackReceived("assistant_message", input, msg);
      await react(client, msg.channel, msg.ts, REACTION.working);

      const events = deps.engine.stream(input);
      let final = "";
      let errored = false;
      try {
        // "plan" groups the steps under one plan block; the default "timeline" renders each as
        // its own standalone task card.
        const stream = sayStream({ task_display_mode: "plan" });
        ({ final, errored } = await pumpRunToStream(stream, events));
        await stream.stop();
      } catch (e) {
        // Streaming/plan block unavailable → degrade to a plain status + Block Kit reply.
        console.warn("[slack] sayStream failed, falling back:", String(e));
        await setStatus("is thinking…");
        ({ final, errored } = await drainToFinal(events));
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

  /** Render one run in a channel thread: ⏳→👀, a plan block + final reply, then 👀→✅/⚠️. */
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
        // "plan" groups the steps under one plan block ("timeline" makes each its own card).
        task_display_mode: "plan",
      });
      ({ final, errored } = await pumpRunToStream(stream, p.events));
      await stream.stop();
    } catch (e) {
      console.warn("[slack] mention stream failed, falling back to postMessage:", String(e));
      // Finish consuming so the Run is recorded even on the fallback path.
      ({ final, errored } = await drainToFinal(p.events));
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
    const userId = await resolveUserId(client, deps.db, ev.user);
    const base = mentionEventToInput(ev, deps.agentId, deps.source, userId);
    const threadTs = ev.thread_ts ?? ev.ts;
    logSlackReceived("mention", base, ev, { contextTeamId: context.teamId ?? null });

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
          user: ev.user,
          refs,
          events,
        }),
    });

    if (queued) await react(client, ev.channel, ev.ts, REACTION.queued);
    else lastSeen.set(base.sourceKey, ev.ts);
    console.log("[slack] mention handled", { queued });
  });

  return app;
}
