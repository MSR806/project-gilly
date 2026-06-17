import type { EngineInput } from "../engine.ts";

/** Fields we read off a Slack message / event (assistant thread or channel mention). */
export type SlackMessageFields = {
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
};

const sourceKeyOf = (m: SlackMessageFields) => `${m.channel}:${m.thread_ts ?? m.ts}`;

/** Pure translation of an assistant-thread message into engine input. */
export function assistantMessageToInput(
  message: SlackMessageFields,
  agentId: string,
  source = "slack",
): Omit<EngineInput, "reply"> {
  return {
    agentId,
    source,
    sourceKey: sourceKeyOf(message),
    userMessage: (message.text ?? "").trim(),
  };
}

/** Pure translation of a channel `app_mention` event — strips the bot mention. */
export function mentionEventToInput(
  event: SlackMessageFields,
  agentId: string,
  source = "slack",
): Omit<EngineInput, "reply"> {
  return {
    agentId,
    source,
    sourceKey: sourceKeyOf(event),
    userMessage: (event.text ?? "").replace(/<@[^>]+>/g, "").trim(),
  };
}
