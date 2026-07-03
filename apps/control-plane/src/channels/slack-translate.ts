import type { MessageInput } from "../engine.ts";

/** Fields we read off a Slack message / event (assistant thread or channel mention). */
export type SlackMessageFields = {
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  team?: string;
  channel_type?: string;
};

const sourceKeyOf = (m: SlackMessageFields) => `${m.channel}:${m.thread_ts ?? m.ts}`;

/** Pure translation of an assistant-thread message into engine input. */
export function assistantMessageToInput(
  message: SlackMessageFields,
  agentId: string,
  source = "slack",
  userId?: string,
): MessageInput {
  return {
    agentId,
    source,
    sourceKey: sourceKeyOf(message),
    userMessage: (message.text ?? "").trim(),
    userId,
  };
}

/** Pure translation of a channel `app_mention` event — strips the bot mention. */
export function mentionEventToInput(
  event: SlackMessageFields,
  agentId: string,
  source = "slack",
  userId?: string,
): MessageInput {
  return {
    agentId,
    source,
    sourceKey: sourceKeyOf(event),
    userMessage: (event.text ?? "").replace(/<@[^>]+>/g, "").trim(),
    userId,
  };
}

/** A prior message in a Slack thread (subset of conversations.replies output). */
export type ThreadMessage = { user?: string; bot_id?: string; text?: string; ts?: string };

/** Render prior thread messages as a simple transcript; skips empties and `excludeTs`. */
export function formatTranscript(messages: ThreadMessage[], excludeTs?: string): string {
  return messages
    .filter((m) => m.text?.trim() && m.ts !== excludeTs)
    .map((m) => {
      const who = m.bot_id ? "assistant" : `<@${m.user ?? "user"}>`;
      return `${who}: ${(m.text ?? "").trim()}`;
    })
    .join("\n");
}
