import { App, Assistant } from "@slack/bolt";
import type { createEngine } from "../engine.ts";
import type { Channel } from "./channel.ts";
import { assistantMessageToInput, type SlackAssistantMessage } from "./slack-translate.ts";

/** Slack channel via the AI assistant surface (Socket Mode). One agent per app. */
export function createSlackChannel(deps: {
  engine: ReturnType<typeof createEngine>;
  botToken: string;
  appToken: string;
  agentId: string;
  source?: string;
}): Channel {
  const app = new App({ token: deps.botToken, appToken: deps.appToken, socketMode: true });

  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }) => {
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
        message as SlackAssistantMessage,
        deps.agentId,
        deps.source,
      );
      await setStatus("is thinking…"); // auto-clears when we `say` the reply
      await deps.engine.handle({ ...input, reply: (text) => say(text).then(() => {}) });
    },
  });

  app.assistant(assistant);
  return { name: "slack", start: () => app.start().then(() => {}) };
}
