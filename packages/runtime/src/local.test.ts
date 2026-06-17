import { expect, test } from "bun:test";
import type { InvocationRequest, StreamEvent } from "@gilly/harness-protocol";
import { LocalRuntimeProvider } from "./local.ts";

const req: InvocationRequest = {
  agent: { id: "a", name: "A", model: "m", systemPrompt: "p" },
  userMessage: "hi",
};

test("invokeStream parses NDJSON StreamEvents from the harness", async () => {
  const lines: StreamEvent[] = [
    { type: "token", text: "he" },
    { type: "token", text: "llo" },
    { type: "done", finalText: "hello", harnessSessionId: "s1" },
  ];
  // Emit in odd chunks to exercise the cross-chunk line buffering.
  const body = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
  });

  const provider = new LocalRuntimeProvider(`http://localhost:${server.port}`);
  const got: StreamEvent[] = [];
  for await (const e of provider.invokeStream(req)) got.push(e);
  server.stop(true);

  expect(got).toEqual(lines);
});
