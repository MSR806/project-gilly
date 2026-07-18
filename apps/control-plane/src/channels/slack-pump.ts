import type { StreamEvent } from "@gilly/runtime";
import {
  newProgressState,
  reduceProgress,
  type SlackMessage,
  toProgressMessage,
  toSlackMessages,
  withRunSummary,
} from "./slack-format.ts";

export type SlackRunDelivery = {
  startProgress(message: SlackMessage): Promise<string>;
  queueProgress(messageTs: string, message: SlackMessage): void;
  finishProgress(messageTs: string, message: SlackMessage): Promise<void>;
  postFinal(message: SlackMessage): Promise<void>;
};

export type SlackRunResult = {
  final: string;
  errored: boolean;
};

/** Consume a run once; Slack progress is best-effort, while final delivery is retried as posts. */
export async function pumpSlackRun(params: {
  events: AsyncIterable<StreamEvent>;
  delivery: SlackRunDelivery;
  onDeliveryError?: (message: string, error: unknown) => void;
}): Promise<SlackRunResult> {
  const report = (message: string, error: unknown) => {
    try {
      params.onDeliveryError?.(message, error);
    } catch {
      // Diagnostics must never interrupt the engine stream.
    }
  };
  let progressTs: string | undefined;
  let progressDisabled = false;
  let progress = newProgressState();
  let tokens = "";
  let finalText: string | undefined;
  let errored = false;

  try {
    progressTs = await params.delivery.startProgress(toProgressMessage(progress));
  } catch (error) {
    progressDisabled = true;
    report("failed to start progress message", error);
  }

  for await (const event of params.events) {
    if (event.type === "token") {
      tokens += event.text;
      continue;
    }
    if (event.type === "done") {
      finalText = event.finalText;
      continue;
    }
    if (event.type === "error") {
      errored = true;
      tokens += `\n\n⚠️ ${event.error}`;
      continue;
    }

    progress = reduceProgress(progress, event);
    if (!progressDisabled && progressTs) {
      try {
        params.delivery.queueProgress(progressTs, toProgressMessage(progress));
      } catch (error) {
        progressDisabled = true;
        report("failed to queue progress update", error);
      }
    }
  }

  const final = (finalText || tokens).trim();
  const messages = toSlackMessages(final);
  const first = messages[0];
  let firstDelivered = false;

  if (progressTs && first) {
    try {
      await params.delivery.finishProgress(progressTs, withRunSummary(first, progress, errored));
      firstDelivered = true;
    } catch (error) {
      report("failed to replace progress message", error);
    }
  }

  for (const message of firstDelivered ? messages.slice(1) : messages) {
    try {
      await params.delivery.postFinal(message);
    } catch (error) {
      report("failed to post final message", error);
      break;
    }
  }

  return { final, errored };
}
