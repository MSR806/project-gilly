import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./client.ts";
import {
  getAgent,
  getGatewayToken,
  getHarness,
  getLegacyAgentConnectors,
  getSessionBySourceKey,
  listHarnesses,
  migrateLegacyAgentTools,
  updateHarness,
} from "./repo.ts";

test("legacy agent/session migration is idempotent and preserves custom models", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gilly-migration-")), "gilly.db");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT NOT NULL,
      system_prompt TEXT NOT NULL, tools TEXT, skills TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, source TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE, harness_session_id TEXT, created_at INTEGER NOT NULL
    );
    INSERT INTO agents VALUES
      ('fast', 'Fast', 'gpt-5.4-fast', 'x', NULL, NULL, 1),
      ('custom', 'Custom', 'private-claude', 'x', NULL, NULL, 2),
      ('open', 'Open', 'gpt-oss-120b', 'x', NULL, NULL, 3);
    INSERT INTO sessions VALUES
      ('s1', 'fast', 'web', 'web:openai', 'openai:thread-1', 1),
      ('s2', 'custom', 'web', 'web:anthropic', 'anthropic:session-2', 2),
      ('s3', 'custom', 'web', 'web:legacy', 'session-3', 3),
      ('s4', 'custom', 'web', 'web:empty', NULL, 4);
  `);
  legacy.close();

  const db = createDb(path);
  expect(getAgent(db, "fast")?.harness).toEqual({
    id: "codex",
    config: { model: "gpt-5.4", serviceTier: "fast" },
  });
  expect(getAgent(db, "custom")?.harness).toEqual({
    id: "claude",
    config: { model: "private-claude" },
  });
  expect(getHarness(db, "claude")?.models).toContainEqual({
    id: "private-claude",
    name: "private-claude",
  });
  expect(getHarness(db, "codex")?.models.some(({ id }) => id === "gpt-oss-120b")).toBe(false);
  expect(getHarness(db, "codex")?.image).toBe("/harnesses/codex.svg");
  expect(getSessionBySourceKey(db, "web:openai")).toMatchObject({
    harnessId: "codex",
    harnessSessionId: "thread-1",
  });
  expect(getSessionBySourceKey(db, "web:anthropic")).toMatchObject({
    harnessId: "claude",
    harnessSessionId: "session-2",
  });
  expect(getSessionBySourceKey(db, "web:legacy")).toMatchObject({
    harnessId: "claude",
    harnessSessionId: "session-3",
  });
  expect(getSessionBySourceKey(db, "web:empty")).toMatchObject({
    harnessId: null,
    harnessSessionId: null,
  });

  const codex = getHarness(db, "codex");
  updateHarness(db, "codex", { ...(codex as NonNullable<typeof codex>), name: "Custom Codex" });
  const reopened = createDb(path);
  expect(getHarness(reopened, "codex")?.name).toBe("Custom Codex");
  expect(getAgent(reopened, "fast")?.harness.config.serviceTier).toBe("fast");
});

test("adds images to the predecessor harness registry without breaking custom rows", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gilly-harness-image-")), "gilly.db");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE harnesses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL, models TEXT NOT NULL
    );
    INSERT INTO harnesses VALUES
      ('claude', 'Operator Claude', 0, '[{"id":"custom","name":"Custom"}]'),
      ('custom', 'Custom Harness', 1, '[]');
  `);
  legacy.close();

  const db = createDb(path);
  expect(getHarness(db, "claude")).toMatchObject({
    name: "Operator Claude",
    image: "/harnesses/claude.svg",
    enabled: false,
    models: [{ id: "custom", name: "Custom" }],
  });
  expect(getHarness(db, "custom")).toEqual({
    id: "custom",
    name: "Custom Harness",
    enabled: true,
    models: [],
  });
  expect(listHarnesses(db).map(({ id }) => id)).toEqual(["claude", "codex", "custom"]);

  const claude = getHarness(db, "claude");
  updateHarness(db, "claude", {
    ...(claude as NonNullable<typeof claude>),
    image: "/harnesses/operator.svg",
  });
  expect(getHarness(createDb(path), "claude")?.image).toBe("/harnesses/operator.svg");
});

test("migrates legacy connectors to exact custom tools without widening providers", () => {
  const path = join(mkdtempSync(join(tmpdir(), "gilly-db-migration-")), "legacy.db");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT NOT NULL,
      system_prompt TEXT NOT NULL, tools TEXT, skills TEXT, connectors TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE gateway_tokens (
      token TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      connectors TEXT NOT NULL, grants TEXT NOT NULL, expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO agents VALUES ('legacy', 'Legacy', 'sonnet', 'Old', NULL, NULL, '["echo"]', 1);
    INSERT INTO gateway_tokens VALUES (
      'legacy-token', 'run', 'user', 'legacy', '["echo"]', '["echo.*"]', 9999999999999, 1
    );
  `);
  legacy.close();

  const db = createDb(path);
  expect(getAgent(db, "legacy")?.gatewayTools).toBeUndefined();
  expect(getLegacyAgentConnectors(db, "legacy")).toEqual(["echo"]);
  expect(
    migrateLegacyAgentTools(db, "legacy", [
      { name: "echo.ping", toolkit: "echo", source: "custom" },
      { name: "echo.send", toolkit: "echo", source: "composio" },
    ]),
  ).toEqual(["echo.ping"]);
  expect(getAgent(db, "legacy")?.gatewayTools).toEqual(["echo.ping"]);
  expect(getLegacyAgentConnectors(db, "legacy")).toEqual([]);
  expect(getGatewayToken(db, "legacy-token")?.tools).toEqual([]);
});
