import { App } from "@slack/bolt";
import type { createEngine } from "../engine.ts";
import type { Channel } from "./channel.ts";
import { slackEventToInput } from "./slack-translate.ts";

/** Slack channel (Socket Mode): routes `app_mention` events into the engine. */
export function createSlackChannel(deps: {
  engine: ReturnType<typeof createEngine>;
  botToken: string;
  appToken: string;
  agentId: string;
  source?: string;
}): Channel {
  const app = new App({ token: deps.botToken, appToken: deps.appToken, socketMode: true });

  app.event("app_mention", async ({ event, client }) => {
    const input = slackEventToInput(event, deps.agentId, deps.source);
    const threadTs = event.thread_ts ?? event.ts;
    await deps.engine.handle({
      ...input,
      reply: (text) =>
        client.chat
          .postMessage({ channel: event.channel, thread_ts: threadTs, text })
          .then(() => {}),
    });
  });

  return { name: "slack", start: () => app.start().then(() => {}) };
}
