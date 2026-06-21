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

test("surfaces a meaningful error when the harness is unreachable", async () => {
  // Nothing is listening on port 1 — fetch rejects with a connection error.
  const provider = new LocalRuntimeProvider("http://localhost:1");
  const drain = async () => {
    for await (const _ of provider.invokeStream(req)) {
      /* connect fails before any event */
    }
  };
  await expect(drain()).rejects.toThrow(/agent runtime is unavailable/i);
  await expect(provider.invoke(req)).rejects.toThrow(/agent runtime is unavailable/i);
});
