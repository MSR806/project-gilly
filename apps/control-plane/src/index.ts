import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDb, getAgent, listAgents } from "@gilly/db";
import { LocalRuntimeProvider } from "@gilly/runtime";
import type { Channel } from "./channels/channel.ts";
import { createSlackChannel } from "./channels/slack.ts";
import { createWebChannel } from "./channels/web.ts";
import { seedAgents } from "./config.ts";
import { createEngine } from "./engine.ts";
import { LocalSkillStore } from "./stores/local-skill-store.ts";

// Defaults are anchored to the repo root (this file lives at apps/control-plane/src/),
// so dev works regardless of cwd. Env vars override (Docker sets absolute paths).
// Resolve against the repo root: relative env values (e.g. from .env) anchor here
// regardless of cwd; absolute values (Docker) pass through unchanged.
const repoRoot = resolve(import.meta.dir, "../../..");
const AGENTS_DIR = resolve(repoRoot, process.env.AGENTS_DIR ?? "config/agents");
const SKILLS_DIR = resolve(repoRoot, process.env.SKILLS_DIR ?? "config/skills");
const DATABASE_PATH = resolve(repoRoot, process.env.DATABASE_PATH ?? "data/gilly.db");
const HARNESS_URL = process.env.HARNESS_URL ?? "http://localhost:8080";
const WEB_PORT = Number(process.env.WEB_PORT ?? 4000);
const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = process.env;

mkdirSync(dirname(DATABASE_PATH), { recursive: true });
const db = createDb(DATABASE_PATH);
seedAgents(db, AGENTS_DIR); // first run only: import config/agents/*.json into the DB
const skillStore = new LocalSkillStore(SKILLS_DIR);

// Agent references to unknown skills now fail at run time (engine.skillsFor), recorded as a failed
// run with a clear message — better than a boot crash for runtime-mutable config.
const agentId = process.env.GILLY_AGENT_ID ?? listAgents(db)[0]?.id ?? "";

const runtime = new LocalRuntimeProvider(HARNESS_URL);
const engine = createEngine({
  db,
  runtime,
  getAgent: (id) => getAgent(db, id),
  getSkill: (name) => skillStore.get(name),
});

// Web is always on (the UI + management API). Slack is optional — only if configured.
const channels: Channel[] = [createWebChannel({ engine, db, skillStore, port: WEB_PORT })];
if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  channels.push(
    createSlackChannel({ engine, botToken: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, agentId }),
  );
} else {
  console.warn("SLACK_BOT_TOKEN/SLACK_APP_TOKEN not set — Slack channel disabled (web only)");
}

await Promise.all(channels.map((c) => c.start()));
console.log(`⚡️ Gilly control plane ready — channels: ${channels.map((c) => c.name).join(", ")}`);
