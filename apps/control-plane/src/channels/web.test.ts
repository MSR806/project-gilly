import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeRun, createDb, createRun, failRun, getOrCreateSession } from "@gilly/db";
import type { createEngine } from "../engine.ts";
import { LocalSkillStore } from "../stores/local-skill-store.ts";
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

test("POST /api/skills persists a skill with supporting files; GET returns them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gilly-web-skills-"));
  const fetch = createWebHandler({
    engine: {} as ReturnType<typeof createEngine>,
    db: createDb(":memory:"),
    skillStore: new LocalSkillStore(dir),
    port: 0,
    gatewayUrl: "http://gw",
    adminToken: "admin-secret",
  });

  const create = await fetch(
    new Request("http://x/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "cac",
        description: "Run CAC.",
        content: "# CAC",
        files: [{ path: "cac.ts", contents: "console.log(1)" }],
      }),
    }),
  );
  expect(create.status).toBe(201);

  const detail = await (await fetch(new Request("http://x/api/skills/cac"))).json();
  expect(detail).toEqual({
    name: "cac",
    description: "Run CAC.",
    content: "# CAC",
    files: [{ path: "cac.ts", contents: "console.log(1)" }],
  });

  const bad = await fetch(
    new Request("http://x/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "evil",
        description: "d",
        content: "c",
        files: [{ path: "../escape.ts", contents: "x" }],
      }),
    }),
  );
  expect(bad.status).toBe(400);
});

test("POST /api/agents/:id/runs starts a background run; GET /api/runs/:id reads it", async () => {
  let seen: Record<string, unknown> | undefined;
  const engine = {
    start(input: Record<string, unknown>) {
      if (input.agentId === "missing") throw new Error("Unknown agent: missing");
      seen = input;
      return { runId: "run-1" };
    },
  } as ReturnType<typeof createEngine>;
  const db = createDb(":memory:");
  const fetch = createWebHandler({
    engine,
    db,
    skillStore: {} as SkillStore,
    port: 0,
    webUserId: "user-1",
  });

  const res = await fetch(
    new Request("http://x/api/agents/helper/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "do it" }),
    }),
  );

  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ runId: "run-1" });
  expect(seen).toMatchObject({
    agentId: "helper",
    source: "gateway",
    userMessage: "do it",
    userId: "user-1",
  });
  expect(String(seen?.sourceKey).startsWith("gateway:")).toBe(true);

  const bad = await fetch(
    new Request("http://x/api/agents/helper/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  expect(bad.status).toBe(400);
  const missing = await fetch(
    new Request("http://x/api/agents/missing/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "do it" }),
    }),
  );
  expect(missing.status).toBe(404);

  const session = getOrCreateSession(db, {
    agentId: "helper",
    source: "gateway",
    sourceKey: "gateway:status-test",
  });
  const run = createRun(db, session.id, "do it");
  completeRun(db, run.id, "Done.");
  const status = await fetch(new Request(`http://x/api/runs/${run.id}`));
  expect(await status.json()).toEqual({
    id: run.id,
    status: "completed",
    output: "Done.",
  });
  const failed = createRun(db, session.id, "fail");
  failRun(db, failed.id, "boom");
  expect(await (await fetch(new Request(`http://x/api/runs/${failed.id}`))).json()).toEqual({
    id: failed.id,
    status: "error",
    error: "boom",
  });
  expect((await fetch(new Request("http://x/api/runs/missing"))).status).toBe(404);
});

// --- Slack connections: redaction + blank-token-keep (no Slack network needed) ---

import { makeVault } from "@gilly/core";
import { createAgent, createSlackConnection, getSlackConnection } from "@gilly/db";
import type { SlackManager } from "./slack-manager.ts";

/** A no-op Slack manager that records which lifecycle calls the routes make. */
function fakeManager() {
  const calls: string[] = [];
  const mgr = {
    name: "slack",
    start: async () => {},
    add: async () => void calls.push("add"),
    remove: async (id: string) => void calls.push(`remove:${id}`),
    restart: async (c: { id: string }) => void calls.push(`restart:${c.id}`),
  } as unknown as SlackManager;
  return { mgr, calls };
}

/** Handler wired with a real vault, a fake manager, and a seeded agent + connection. */
function slackHandler() {
  const db = createDb(":memory:");
  const vault = makeVault("test-key");
  const { mgr, calls } = fakeManager();
  createAgent(db, { id: "coder", name: "Coder", model: "m", systemPrompt: "x" });
  createSlackConnection(db, {
    id: "conn-1",
    name: "Acme",
    agentId: "coder",
    botToken: vault.encrypt("xoxb-secret"),
    appToken: vault.encrypt("xapp-secret"),
    teamId: "T1",
    teamName: "Acme Inc",
    status: "active",
    createdAt: 1,
  });
  const fetch = createWebHandler({
    engine: {} as ReturnType<typeof createEngine>,
    db,
    skillStore: {} as SkillStore,
    port: 0,
    vault,
    slackManager: mgr,
  });
  return { fetch, db, vault, calls };
}

test("GET connections never leaks tokens (redacted list + detail)", async () => {
  const { fetch } = slackHandler();
  const list = (await (
    await fetch(new Request("http://x/api/slack/connections"))
  ).json()) as unknown[];
  expect(JSON.stringify(list)).not.toContain("xoxb");
  expect(JSON.stringify(list)).not.toContain("appToken");
  const one = (await (
    await fetch(new Request("http://x/api/slack/connections/conn-1"))
  ).json()) as Record<string, unknown>;
  expect(one).toMatchObject({
    id: "conn-1",
    teamName: "Acme Inc",
    hasBotToken: true,
    hasAppToken: true,
  });
  expect(one.botToken).toBeUndefined();
  expect(one.appToken).toBeUndefined();
});

test("PUT with blank tokens keeps the stored tokens and restarts the connection", async () => {
  const { fetch, db, vault, calls } = slackHandler();
  const res = await fetch(
    new Request("http://x/api/slack/connections/conn-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed", agentId: "coder" }),
    }),
  );
  expect(res.status).toBe(200);
  const stored = getSlackConnection(db, "conn-1");
  expect(stored?.name).toBe("Renamed");
  expect(vault.decrypt(stored?.botToken ?? "")).toBe("xoxb-secret"); // unchanged
  expect(vault.decrypt(stored?.appToken ?? "")).toBe("xapp-secret"); // unchanged
  expect(calls).toContain("restart:conn-1");
});

test("DELETE stops the socket and removes the row", async () => {
  const { fetch, db, calls } = slackHandler();
  const res = await fetch(
    new Request("http://x/api/slack/connections/conn-1", { method: "DELETE" }),
  );
  expect(res.status).toBe(200);
  expect(getSlackConnection(db, "conn-1")).toBeUndefined();
  expect(calls).toContain("remove:conn-1");
});
