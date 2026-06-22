import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createDb,
  loadAgentConfigsFromDb,
  loadSkillBundlesFromDb,
  seedRegistryFromConfig,
} from "@gilly/db";
import { LocalRuntimeProvider } from "@gilly/runtime";
import type { Channel } from "./channels/channel.ts";
import { createSlackChannel } from "./channels/slack.ts";
import { createWebChannel } from "./channels/web.ts";
import { assertReferencesResolve, loadAgents, loadSkills } from "./config.ts";
import { createEngine } from "./engine.ts";

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

// 1. Load file-based configs (for backwards-compat seeding).
const fileAgents = loadAgents(AGENTS_DIR);
const fileSkills = loadSkills(SKILLS_DIR);
assertReferencesResolve(fileAgents, fileSkills);

// 2. Open the database and seed file configs into the registry.
mkdirSync(dirname(DATABASE_PATH), { recursive: true });
const db = createDb(DATABASE_PATH);
seedRegistryFromConfig(db, fileAgents, fileSkills);

// 3. Build mutable runtime maps from DB (these are what the engine and API use).
const agents = loadAgentConfigsFromDb(db);
const skills = loadSkillBundlesFromDb(db);
assertReferencesResolve(agents, skills);

const agentId = process.env.GILLY_AGENT_ID ?? agents.keys().next().value ?? "";

const runtime = new LocalRuntimeProvider(HARNESS_URL);
const engine = createEngine({ db, runtime, agents, skills });

// Web is always on (the UI + management API). Slack is optional — only if configured.
const channels: Channel[] = [createWebChannel({ engine, agents, skills, db, port: WEB_PORT })];
if (SLACK_BOT_TOKEN && SLACK_APP_TOKEN) {
  channels.push(
    createSlackChannel({ engine, botToken: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, agentId }),
  );
} else {
  console.warn("SLACK_BOT_TOKEN/SLACK_APP_TOKEN not set — Slack channel disabled (web only)");
}

await Promise.all(channels.map((c) => c.start()));
console.log(`⚡️ Gilly control plane ready — channels: ${channels.map((c) => c.name).join(", ")}`);
