import type { StreamEvent } from "@gilly/runtime";
import type { KnownBlock } from "@slack/types";
import {
  appendSlackActivity,
  renderSlackActivity,
  type SlackActivity,
  toSlackActivity,
} from "./slack-activity.ts";

const MARKDOWN_MESSAGE_LIMIT = 12000;
const MAX_FENCE_MARKER_LENGTH = 100;

type Fence = {
  character: "`" | "~";
  length: number;
  opener: string;
};

/** One Slack message payload containing a single, size-safe markdown block. */
export type SlackMessage = { blocks: KnownBlock[]; text: string };

/** Pure progress state: the full count plus only the operations still visible. */
export type ProgressState = {
  totalSteps: number;
  recentSteps: readonly SlackActivity[];
};

const truncate = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;

export const newProgressState = (): ProgressState => ({ totalSteps: 0, recentSteps: [] });

/** Retain the total operation count and the three most recent grouped Slack activities. */
export function reduceProgress(state: ProgressState, event: StreamEvent): ProgressState {
  if (event.type !== "tool" && event.type !== "message") return state;
  return {
    totalSteps: state.totalSteps + 1,
    recentSteps: appendSlackActivity(state.recentSteps, toSlackActivity(event)),
  };
}

/** Render the latest progress snapshot for a normal editable Slack message. */
export function renderProgress(state: ProgressState): string {
  if (state.totalSteps === 0) return "Working · starting…";

  const summary = `Working · ${state.totalSteps} ${state.totalSteps === 1 ? "step" : "steps"}`;
  const rows = state.recentSteps.map(renderSlackActivity);
  return [summary, ...rows].join("\n");
}

/** Plain-text fallback for Slack notifications and accessibility. */
export function fallbackText(markdown: string): string {
  const text = markdown.trim();
  return text.length > 200 ? `${text.slice(0, 197)}…` : text || "(no response)";
}

function fenceAfter(text: string, initial: Fence | null): Fence | null {
  let active = initial;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (active) {
      const close = trimmed.match(/^(`{3,}|~{3,})\s*$/)?.[1];
      if (close?.[0] === active.character && close.length >= active.length) active = null;
      continue;
    }

    const opening = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    const marker = opening?.[1];
    if (!marker || marker.length > MAX_FENCE_MARKER_LENGTH) continue;
    const character = marker[0];
    if (character !== "`" && character !== "~") continue;
    active = {
      character,
      length: marker.length,
      opener: truncate(trimmed, 200),
    };
  }
  return active;
}

function preferredCut(text: string, maximum: number): number {
  const candidate = text.slice(0, maximum);
  const paragraph = candidate.lastIndexOf("\n\n");
  if (paragraph >= maximum / 2) return paragraph + 2;
  const newline = candidate.lastIndexOf("\n");
  if (newline >= maximum / 2) return newline + 1;
  const space = candidate.lastIndexOf(" ");
  return space >= maximum / 2 ? space + 1 : maximum;
}

/**
 * Split Markdown into message-sized strings. When a split lands inside a fenced code block, close
 * it in the current message and reopen it in the next so each payload renders independently.
 */
function splitMarkdown(markdown: string): string[] {
  const normalized = markdown.trim() || "_(no response)_";
  const messages: string[] = [];
  let remaining = normalized;
  let fence: Fence | null = null;

  while (remaining.length > 0) {
    const prefix = fence ? `${fence.opener}\n` : "";
    if (prefix.length + remaining.length <= MARKDOWN_MESSAGE_LIMIT) {
      messages.push(`${prefix}${remaining}`);
      break;
    }

    // Reserve enough space for a newline plus the largest fence marker we recognize.
    const maximum = MARKDOWN_MESSAGE_LIMIT - prefix.length - MAX_FENCE_MARKER_LENGTH - 1;
    const cut = preferredCut(remaining, maximum);
    const original = remaining.slice(0, cut);
    const nextFence = fenceAfter(original, fence);
    const suffix = nextFence
      ? `${original.endsWith("\n") ? "" : "\n"}${nextFence.character.repeat(nextFence.length)}`
      : "";
    messages.push(`${prefix}${original}${suffix}`);
    remaining = remaining.slice(cut);
    fence = nextFence;
  }

  return messages;
}

/** Build one Slack payload per ≤12k Markdown segment, with a notification fallback for each. */
export function toSlackMessages(markdown: string): SlackMessage[] {
  return splitMarkdown(markdown).map((text) => ({
    blocks: [{ type: "markdown", text }],
    text: fallbackText(text),
  }));
}
