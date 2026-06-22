import type { StreamEvent } from "@gilly/runtime";
import type { AnyChunk, KnownBlock } from "@slack/types";

// Slack's `markdown` block renders standard Markdown directly (no mrkdwn conversion),
// capped at 12k chars per block.
const MARKDOWN_BLOCK_LIMIT = 12000;

/** Split a string into ≤`size` chunks, preferring to break on a newline. */
function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const slice = rest.slice(0, size);
    const nl = slice.lastIndexOf("\n");
    const cut = nl > size * 0.5 ? nl : size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/** Render agent Markdown into Block Kit `markdown` blocks (chunked to the size limit). */
export function toBlocks(markdown: string): KnownBlock[] {
  const text = markdown.trim() || "_(no response)_";
  return chunk(text, MARKDOWN_BLOCK_LIMIT).map((t) => ({ type: "markdown", text: t }));
}

/** Plain-text fallback (Slack notifications / accessibility); truncated. */
export function fallbackText(markdown: string): string {
  const text = markdown.trim();
  return text.length > 200 ? `${text.slice(0, 197)}…` : text || "(no response)";
}

// --- Plan-block timeline -------------------------------------------------------------------------
// Progress renders as a Slack plan block: a `plan_update` title with `task_update` steps beneath
// it. Each tool call / intermediate assistant message becomes one step; the final answer is the
// message body, not a step.

/** The plan-block header shown above the step timeline. */
export const PLAN = { working: "Working…", done: "Done", error: "Failed" } as const;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * A step's label: tool calls show the tool name (bold) with the arg summary as the sub-line;
 * narration shows its first line as the title and the full text as the sub-line (so nothing is
 * lost to the title trim). `details` is omitted when it would just repeat the title.
 */
function stepLabel(ev: Extract<StreamEvent, { type: "tool" | "message" }>): {
  title: string;
  details?: string;
} {
  if (ev.type === "tool")
    return ev.summary ? { title: ev.name, details: ev.summary } : { title: ev.name };
  const text = ev.text.trim();
  const nl = text.indexOf("\n");
  const firstLine = (nl === -1 ? text : text.slice(0, nl)).trim();
  const title = truncate(firstLine, 150) || "Thinking…";
  // Sub-line: the lines after the first; or the whole text when the first line itself was trimmed.
  const rest = nl === -1 ? "" : text.slice(nl + 1).trim();
  const sub = firstLine.length > 150 ? text : rest;
  return sub ? { title, details: truncate(sub, 2000) } : { title };
}

/** State threaded across a run's timeline: how many steps so far, and the open (in-progress) one. */
export type StepState = { count: number; open: { id: string; title: string } | null };
export const newStepState = (): StepState => ({ count: 0, open: null });

/**
 * Advance the timeline for one event: complete the previously-open step and open a new
 * in-progress one. Only `tool`/`message` events produce steps; others yield no chunks.
 * Pure — returns the next state alongside the chunks to append.
 */
export function advanceSteps(
  state: StepState,
  ev: StreamEvent,
): { state: StepState; chunks: AnyChunk[] } {
  if (ev.type !== "tool" && ev.type !== "message") return { state, chunks: [] };
  const chunks: AnyChunk[] = [];
  if (state.open) {
    chunks.push({
      type: "task_update",
      id: state.open.id,
      title: state.open.title,
      status: "complete",
    });
  }
  const count = state.count + 1;
  const id = `step-${count}`;
  const { title, details } = stepLabel(ev);
  chunks.push({
    type: "task_update",
    id,
    title,
    status: "in_progress",
    ...(details ? { details } : {}),
  });
  return { state: { count, open: { id, title } }, chunks };
}

/** Close the timeline: settle the open step as complete (or error). Pure. */
export function closeSteps(state: StepState, errored: boolean): AnyChunk[] {
  if (!state.open) return [];
  return [
    {
      type: "task_update",
      id: state.open.id,
      title: state.open.title,
      status: errored ? "error" : "complete",
    },
  ];
}
