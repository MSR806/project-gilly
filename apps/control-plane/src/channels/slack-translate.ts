import type { EngineInput } from "../engine.ts";

/** Minimal shape of a Slack `app_mention` event we depend on. */
export type SlackMentionEvent = {
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
};

/** Pure translation of a Slack mention into engine input (no Bolt, no I/O). */
export function slackEventToInput(
  event: SlackMentionEvent,
  agentId: string,
  source = "slack",
): Omit<EngineInput, "reply"> {
  const threadTs = event.thread_ts ?? event.ts;
  return {
    agentId,
    source,
    // A thread is the unit of conversation; the top-level mention seeds its own thread.
    sourceKey: `${event.channel}:${threadTs}`,
    userMessage: (event.text ?? "").replace(/<@[^>]+>/g, "").trim(),
  };
}
