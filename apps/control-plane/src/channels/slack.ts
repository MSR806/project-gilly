import { App, Assistant, LogLevel } from "@slack/bolt";
import type { createEngine } from "../engine.ts";
import type { Channel } from "./channel.ts";
import {
  assistantMessageToInput,
  mentionEventToInput,
  type SlackMessageFields,
} from "./slack-translate.ts";

/** Slack channel via the AI assistant surface (Socket Mode). One agent per app. */
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
    // Set SLACK_DEBUG=1 to see the socket connection + every received event.
    logLevel: process.env.SLACK_DEBUG ? LogLevel.DEBUG : LogLevel.INFO,
  });

  // Surface anything Bolt would otherwise swallow.
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
    userMessage: async ({ message, say, setStatus }) => {
      const input = assistantMessageToInput(
        message as SlackMessageFields,
        deps.agentId,
        deps.source,
      );
      console.log(`[slack] assistant message "${input.userMessage}" (${input.sourceKey})`);
      await setStatus("is thinking…"); // auto-clears when we `say` the reply
      await deps.engine.handle({ ...input, reply: (text) => say(text).then(() => {}) });
      console.log("[slack] assistant reply sent");
    },
  });

  app.assistant(assistant);

  // Channel mentions: @gilly in a channel the bot is a member of.
  app.event("app_mention", async ({ event, client }) => {
    const input = mentionEventToInput(event as SlackMessageFields, deps.agentId, deps.source);
    const threadTs = event.thread_ts ?? event.ts;
    console.log(`[slack] mention "${input.userMessage}" (${input.sourceKey})`);
    await deps.engine.handle({
      ...input,
      reply: (text) =>
        client.chat
          .postMessage({ channel: event.channel, thread_ts: threadTs, text })
          .then(() => {}),
    });
    console.log("[slack] mention reply sent");
  });

  return { name: "slack", start: () => app.start().then(() => {}) };
}
