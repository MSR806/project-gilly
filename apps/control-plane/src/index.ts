import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDb } from "@gilly/db";
import { LocalRuntimeProvider } from "@gilly/runtime";
import type { Channel } from "./channels/channel.ts";
import { createSlackChannel } from "./channels/slack.ts";
import { createWebChannel } from "./channels/web.ts";
import { loadAgents } from "./config.ts";
import { createEngine } from "./engine.ts";

const AGENTS_DIR = process.env.AGENTS_DIR ?? "./config/agents";
const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/gilly.db";
const HARNESS_URL = process.env.HARNESS_URL ?? "http://localhost:8080";
const WEB_PORT = Number(process.env.WEB_PORT ?? 4000);
const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = process.env;

const agents = loadAgents(AGENTS_DIR);
// loadAgents throws on an empty dir, so there is always a first agent to bind to.
const agentId = process.env.GILLY_AGENT_ID ?? agents.keys().next().value ?? "";

mkdirSync(dirname(DATABASE_PATH), { recursive: true });
const db = createDb(DATABASE_PATH);
const runtime = new LocalRuntimeProvider(HARNESS_URL);
const engine = createEngine({ db, runtime, agents });

// Web is always on (the UI + management API). Slack is optional — only if configured.
const channels: Channel[] = [createWebChannel({ engine, agents, port: WEB_PORT })];
if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  channels.push(
    createSlackChannel({ engine, botToken: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, agentId }),
  );
} else {
  console.warn("SLACK_BOT_TOKEN/SLACK_APP_TOKEN not set — Slack channel disabled (web only)");
}

await Promise.all(channels.map((c) => c.start()));
console.log(`⚡️ Gilly control plane ready — channels: ${channels.map((c) => c.name).join(", ")}`);
