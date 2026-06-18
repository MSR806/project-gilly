import type { KnownBlock } from "@slack/types";

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
