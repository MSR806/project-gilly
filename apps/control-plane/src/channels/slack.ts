import { type Db, upsertUserBySlackId } from "@gilly/db";
import type { StreamEvent } from "@gilly/runtime";
import { App, Assistant, LogLevel } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { createEngine } from "../engine.ts";
import { pumpSlackRun, type SlackRunDelivery } from "./slack-pump.ts";
import {
  assistantMessageToInput,
  formatTranscript,
  mentionEventToInput,
  type SlackMessageFields,
  type ThreadMessage,
} from "./slack-translate.ts";
import { createSlackUpdateScheduler } from "./slack-update-scheduler.ts";

// Reaction lifecycle on the user's message: queued ⏳ → working 👀 → done ✅ (or ⚠️).
const REACTION = {
  queued: "hourglass_flowing_sand",
  working: "eyes",
  done: "white_check_mark",
  error: "warning",
};

type SlackUpdate = { channel: string; ts: string; text: string; blocks?: KnownBlock[] };
type SlackPost = (message: { text: string; blocks?: KnownBlock[] }) => Promise<{ ts?: string }>;

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

  const updates = createSlackUpdateScheduler<SlackUpdate>({
    send: (update) => app.client.chat.update(update),
    onError: (error) => console.warn("[slack] progress update failed:", String(error)),
  });

  const runDelivery = (channel: string, post: SlackPost): SlackRunDelivery => ({
    async startProgress(text) {
      const response = await post({ text });
      if (!response.ts) throw new Error("Slack progress message returned no timestamp");
      return response.ts;
    },
    queueProgress(ts, text) {
      updates.schedule({ channel, ts, text });
    },
    async finishProgress(ts, message) {
      await updates.finalize({ channel, ts, ...message });
    },
    async postFinal(message) {
      await post(message);
    },
  });

  const logDeliveryError = (message: string, error: unknown) =>
    console.warn(`[slack] ${message}:`, String(error));

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
    // Assistant panel and channel mentions share the same resilient, single-consumption run pump.
    userMessage: async ({ message, client, say }) => {
      const msg = message as SlackMessageFields;
      const userId = await resolveUserId(client, deps.db, msg.user);
      const input = assistantMessageToInput(msg, deps.agentId, deps.source, userId);
      logSlackReceived("assistant_message", input, msg);
      await react(client, msg.channel, msg.ts, REACTION.working);

      const { errored } = await pumpSlackRun({
        events: deps.engine.stream(input),
        delivery: runDelivery(msg.channel, async (payload) => say(payload)),
        onDeliveryError: logDeliveryError,
      });
      await react(client, msg.channel, msg.ts, REACTION.working, false);
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

  /** Render one run in a channel thread: ⏳→👀, rolling progress, final reply, then 👀→✅/⚠️. */
  async function streamRunToSlack(
    client: WebClient,
    p: {
      channel: string;
      threadTs: string;
      refs: string[];
      events: AsyncIterable<StreamEvent>;
    },
  ) {
    await swap(client, p.channel, p.refs, REACTION.queued, REACTION.working);
    const { errored } = await pumpSlackRun({
      events: p.events,
      delivery: runDelivery(p.channel, async (payload) =>
        client.chat.postMessage({ channel: p.channel, thread_ts: p.threadTs, ...payload }),
      ),
      onDeliveryError: logDeliveryError,
    });
    await swap(
      client,
      p.channel,
      p.refs,
      REACTION.working,
      errored ? REACTION.error : REACTION.done,
    );
  }

  // Channel mentions: delta thread context, rolling progress + final reply, queued ⏳ → 👀 → ✅.
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
      run: async ({ refs, events }) => {
        await streamRunToSlack(client, {
          channel: ev.channel,
          threadTs,
          refs,
          events,
        });
        const latestRef = refs.at(-1);
        if (latestRef) lastSeen.set(base.sourceKey, latestRef);
      },
    });

    if (queued) await react(client, ev.channel, ev.ts, REACTION.queued);
    console.log("[slack] mention handled", { queued });
  });

  return app;
}
