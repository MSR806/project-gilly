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
  withThreadContext,
} from "./slack-translate.ts";

// Reaction lifecycle on the user's message.
const REACTION = {
  ack: "eyes",
  queued: "hourglass_flowing_sand",
  done: "white_check_mark",
  error: "warning",
};

/** Add/remove a reaction; never let a reaction failure break the reply. */
async function react(client: WebClient, channel: string, ts: string, name: string, add = true) {
  try {
    if (add) await client.reactions.add({ channel, timestamp: ts, name });
    else await client.reactions.remove({ channel, timestamp: ts, name });
  } catch (e) {
    console.warn(`[slack] reaction ${name} failed:`, String(e));
  }
}

/** Pull prior thread messages (best-effort) when a mention lands inside a thread. */
async function threadContext(
  client: WebClient,
  channel: string,
  threadTs: string,
  excludeTs: string,
) {
  try {
    const res = await client.conversations.replies({ channel, ts: threadTs, limit: 20 });
    return formatTranscript((res.messages ?? []) as ThreadMessage[], excludeTs);
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
    // Assistant panel: a task_card (working → done) with the reply streamed alongside it.
    userMessage: async ({ message, client, sayStream, say, setStatus }) => {
      const msg = message as SlackMessageFields;
      const input = assistantMessageToInput(msg, deps.agentId, deps.source);
      console.log(`[slack] assistant message "${input.userMessage}" (${input.sourceKey})`);
      await react(client, msg.channel, msg.ts, REACTION.ack);

      const taskId = "answer";
      const title = "Answering your request";
      try {
        const stream = sayStream();
        await stream.append({
          chunks: [{ type: "task_update", id: taskId, title, status: "in_progress" }],
        });

        let final = "";
        let errored = false;
        for await (const event of deps.engine.stream(input)) {
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
            { type: "task_update", id: taskId, title, status: errored ? "error" : "complete" },
          ],
        });
        await stream.stop();
        await react(client, msg.channel, msg.ts, errored ? REACTION.error : REACTION.done);
        console.log("[slack] assistant reply sent", { errored, len: final.length });
      } catch (e) {
        // Streaming/task_card unavailable → degrade to a plain status + reply.
        console.warn("[slack] sayStream failed, falling back:", String(e));
        await setStatus("is thinking…");
        await deps.engine.handle({
          ...input,
          reply: (text) => say({ blocks: toBlocks(text), text: fallbackText(text) }).then(() => {}),
        });
        await react(client, msg.channel, msg.ts, REACTION.done);
      }
    },
  });

  app.assistant(assistant);

  // Channel mentions: ack reaction, thread context, Block Kit reply, done/queued reaction.
  app.event("app_mention", async ({ event, client }) => {
    const ev = event as SlackMessageFields;
    const base = mentionEventToInput(ev, deps.agentId, deps.source);
    const threadTs = ev.thread_ts ?? ev.ts;
    console.log(`[slack] mention "${base.userMessage}" (${base.sourceKey})`);
    await react(client, ev.channel, ev.ts, REACTION.ack);

    // If mentioned inside an existing thread, give the agent that conversation.
    const transcript = ev.thread_ts
      ? await threadContext(client, ev.channel, ev.thread_ts, ev.ts)
      : "";
    const userMessage = withThreadContext(base.userMessage, transcript);

    const { queued } = await deps.engine.handle({
      ...base,
      userMessage,
      reply: (text) =>
        client.chat
          .postMessage({
            channel: ev.channel,
            thread_ts: threadTs,
            blocks: toBlocks(text),
            text: fallbackText(text),
          })
          .then(() => {}),
    });

    if (queued) {
      await react(client, ev.channel, ev.ts, REACTION.queued);
    } else {
      await react(client, ev.channel, ev.ts, REACTION.ack, false);
      await react(client, ev.channel, ev.ts, REACTION.done);
    }
    console.log("[slack] mention handled", { queued });
  });

  return { name: "slack", start: () => app.start().then(() => {}) };
}
