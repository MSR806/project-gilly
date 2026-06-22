import { expect, test } from "bun:test";
import type { AgentConfig } from "@gilly/core";
import { createDb, type Db, loadAgentConfigsFromDb, loadSkillBundlesFromDb } from "@gilly/db";
import type { SkillBundle } from "@gilly/harness-protocol";
import { createWebChannel } from "./web.ts";

/** Capture the internal fetch handler from createWebChannel without opening a socket. */
function createTestServer() {
  const db: Db = createDb(":memory:");
  const agents = new Map<string, AgentConfig>();
  const skills = new Map<string, SkillBundle>();
  const engine = {
    handle: async () => ({ queued: false }),
    stream: async function* () {
      yield { type: "done", finalText: "ok", harnessSessionId: null };
    },
  } as unknown as ReturnType<typeof import("../engine.ts").createEngine>;

  const ch = createWebChannel({ engine, agents, skills, db, port: 0 });

  let handler: (req: Request) => Promise<Response> = undefined as unknown as (
    req: Request,
  ) => Promise<Response>;
  const originalServe = Bun.serve;
  // @ts-expect-error - capture the fetch handler without opening a real socket
  Bun.serve = (opts: { fetch: typeof handler }) => {
    handler = opts.fetch;
    return { port: 0, stop: () => {} };
  };
  ch.start();
  Bun.serve = originalServe;

  return { db, agents, skills, fetch: handler };
}

test("GET /api/agents returns empty list initially", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(new Request("http://localhost/api/agents"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("GET /api/skills returns empty list initially", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(new Request("http://localhost/api/skills"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /api/skills creates a skill", async () => {
  const { fetch, skills, db } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "test-skill", content: "# My Skill\nDoes things." }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { name: string };
  expect(body.name).toBe("test-skill");
  expect(skills.has("test-skill")).toBe(true);
  expect(loadSkillBundlesFromDb(db).has("test-skill")).toBe(true);
});

test("POST /api/skills rejects duplicate skill", async () => {
  const { fetch, skills } = createTestServer();
  skills.set("existing", { name: "existing", files: [{ path: "SKILL.md", contents: "x" }] });
  const res = await fetch(
    new Request("http://localhost/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "existing", content: "# Dup" }),
    }),
  );
  expect(res.status).toBe(409);
});

test("POST /api/skills rejects missing fields", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    }),
  );
  expect(res.status).toBe(400);
});

test("POST /api/agents creates an agent with skills", async () => {
  const { fetch, agents, skills, db } = createTestServer();
  skills.set("my-skill", { name: "my-skill", files: [{ path: "SKILL.md", contents: "x" }] });

  const res = await fetch(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "new-agent",
        name: "New Agent",
        model: "sonnet",
        systemPrompt: "You help.",
        tools: ["Read"],
        skills: ["my-skill"],
      }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; skills: string[] };
  expect(body.id).toBe("new-agent");
  expect(body.skills).toEqual(["my-skill"]);
  expect(agents.has("new-agent")).toBe(true);
  expect(loadAgentConfigsFromDb(db).get("new-agent")?.skills).toEqual(["my-skill"]);
});

test("POST /api/agents rejects duplicate id", async () => {
  const { fetch, agents } = createTestServer();
  agents.set("dup", { id: "dup", name: "Dup", model: "sonnet", systemPrompt: "x" });
  const res = await fetch(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "dup", name: "Dup2", model: "sonnet", systemPrompt: "y" }),
    }),
  );
  expect(res.status).toBe(409);
});

test("POST /api/agents rejects unknown skill reference", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "bad",
        name: "Bad",
        model: "sonnet",
        systemPrompt: "x",
        skills: ["nonexistent"],
      }),
    }),
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("nonexistent");
});

test("POST /api/agents rejects invalid body", async () => {
  const { fetch } = createTestServer();
  const res = await fetch(
    new Request("http://localhost/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "", name: "" }),
    }),
  );
  expect(res.status).toBe(400);
});
