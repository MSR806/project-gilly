import type { EngineInput } from "../engine.ts";

/** Fields we read off a Slack assistant-thread message. */
export type SlackAssistantMessage = {
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
};

/** Pure translation of an assistant-thread message into engine input (no Bolt, no I/O). */
export function assistantMessageToInput(
  message: SlackAssistantMessage,
  agentId: string,
  source = "slack",
): Omit<EngineInput, "reply"> {
  // Every assistant message lives in a thread; the opener seeds its own.
  const threadTs = message.thread_ts ?? message.ts;
  return {
    agentId,
    source,
    sourceKey: `${message.channel}:${threadTs}`,
    userMessage: (message.text ?? "").trim(),
  };
}
