import { afterEach, expect, test } from "bun:test";
import { createDb } from "@gilly/db";
import type { createEngine } from "../engine.ts";
import type { SkillStore } from "../stores/skill-store.ts";
import { createWebHandler } from "./web.ts";

// The proxy routes only need db + gateway config; engine/skillStore are unused by them.
const handler = () =>
  createWebHandler({
    engine: {} as ReturnType<typeof createEngine>,
    db: createDb(":memory:"),
    skillStore: {} as SkillStore,
    port: 0,
    gatewayUrl: "http://gw",
    adminToken: "admin-secret",
  });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("PUT credentials proxy injects x-admin-token and forwards the body", async () => {
  let seen: Request | undefined;
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    seen = new Request(input as string, init);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const res = await handler()(
    new Request("http://x/api/connectors/github/credentials", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "github_pat", value: "SECRET" }),
    }),
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(seen?.url).toBe("http://gw/admin/credentials/github");
  expect(seen?.headers.get("x-admin-token")).toBe("admin-secret");
  expect(await seen?.text()).toBe(JSON.stringify({ key: "github_pat", value: "SECRET" }));
});

test("connect proxy relays the gateway's 302 Location to the browser", async () => {
  globalThis.fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://auth.atlassian.com/authorize" },
    })) as unknown as typeof fetch;

  const res = await handler()(new Request("http://x/api/connectors/jira/connect"));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://auth.atlassian.com/authorize");
});

test("connect proxy bounces back to the connectors page when already connected (200)", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, message: "already connected" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const res = await handler()(new Request("http://x/api/connectors/jira/connect"));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/connectors?connected=jira");
});
