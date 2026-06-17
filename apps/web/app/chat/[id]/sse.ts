export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "done"; finalText: string; harnessSessionId: string | null }
  | { type: "error"; error: string };

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (let sep = buffer.indexOf("\n\n"); sep !== -1; sep = buffer.indexOf("\n\n")) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const json = line.slice("data:".length).trim();
        if (!json) continue;
        yield JSON.parse(json) as StreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
