/// <reference types="bun" />

import { expect, test } from "bun:test";
import { activityFor, parseSseStream } from "./sse";

test("parseSseStream accepts heartbeat events", async () => {
  const body = new Response(
    'data: {"type":"heartbeat"}\n\ndata: {"type":"done","finalText":"ok","harnessSessionId":null}\n\n',
  ).body;
  if (!body) throw new Error("missing response body");

  const events = [];
  for await (const event of parseSseStream(body)) events.push(event);

  expect(events).toEqual([
    { type: "heartbeat" },
    { type: "done", finalText: "ok", harnessSessionId: null },
  ]);
});

test("activityFor shows only initial and silent-period status", () => {
  expect(activityFor("send")).toBe("Thinking…");
  expect(activityFor("heartbeat")).toBe("Still working…");
  expect(activityFor("tool")).toBeNull();
  expect(activityFor("token")).toBeNull();
  expect(activityFor("done")).toBeNull();
  expect(activityFor("error")).toBeNull();
});
