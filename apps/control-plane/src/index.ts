import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDb } from "@gilly/db";
import { LocalRuntimeProvider } from "@gilly/runtime";
import type { Channel } from "./channels/channel.ts";
import { createSlackChannel } from "./channels/slack.ts";
import { loadAgents } from "./config.ts";
import { createEngine } from "./engine.ts";

const AGENTS_DIR = process.env.AGENTS_DIR ?? "./config/agents";
const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/gilly.db";
const HARNESS_URL = process.env.HARNESS_URL ?? "http://localhost:8080";
const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = process.env;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error("Missing SLACK_BOT_TOKEN and/or SLACK_APP_TOKEN");
  process.exit(1);
}

const agents = loadAgents(AGENTS_DIR);
// loadAgents throws on an empty dir, so there is always a first agent to bind to.
const agentId = process.env.GILLY_AGENT_ID ?? agents.keys().next().value ?? "";

mkdirSync(dirname(DATABASE_PATH), { recursive: true });
const db = createDb(DATABASE_PATH);
const runtime = new LocalRuntimeProvider(HARNESS_URL);
const engine = createEngine({ db, runtime, agents });

const channel: Channel = createSlackChannel({
  engine,
  botToken: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  agentId,
});

await channel.start();
console.log(`⚡️ Gilly control plane ready — agent "${agentId}", ${agents.size} loaded`);
