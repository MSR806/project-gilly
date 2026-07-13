import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { makeVault } from "@gilly/core";
import {
  createDb,
  failRunningRunsBySource,
  getAgent,
  setAdmin,
  upsertUserBySlackId,
} from "@gilly/db";
import { LocalRuntimeProvider } from "@gilly/runtime";
import type { Channel } from "./channels/channel.ts";
import { createSlackManager } from "./channels/slack-manager.ts";
import { createWebChannel } from "./channels/web.ts";
import { syncAgents } from "./config.ts";
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
const GILLY_GATEWAY_URL = process.env.GILLY_GATEWAY_URL;
const GILLY_ADMIN_TOKEN = process.env.GILLY_ADMIN_TOKEN;

const vaultKey = process.env.GILLY_VAULT_KEY;
if (!vaultKey) throw new Error("GILLY_VAULT_KEY is required (encrypts Slack connection tokens)");

mkdirSync(dirname(DATABASE_PATH), { recursive: true });
const db = createDb(DATABASE_PATH);
const abandoned = failRunningRunsBySource(
  db,
  "gateway",
  "Control plane restarted before the run completed.",
);
if (abandoned) console.warn(`[engine] failed ${abandoned} abandoned background run(s)`);
syncAgents(db, AGENTS_DIR); // every boot: upsert config/agents/*.json into the DB (files win)
const skillStore = new LocalSkillStore(SKILLS_DIR);
const vault = makeVault(vaultKey);

// Web chat has no auth yet: every web request runs as one shared admin user, so it gets full
// access to whatever an agent's connectors allow. Replace with real identity when web auth lands.
const webUser = upsertUserBySlackId(db, { slackUserId: "web", name: "Web (shared)" });
setAdmin(db, webUser.id, true);

const runtime = new LocalRuntimeProvider(HARNESS_URL);
const engine = createEngine({
  db,
  runtime,
  getAgent: (id) => getAgent(db, id),
  getSkill: (name) => skillStore.get(name),
  gatewayUrl: GILLY_GATEWAY_URL,
});

// The Slack manager owns all web-configured connections (started from the DB); it's also handed to
// the web channel so the management API can add/edit/remove connections without a restart.
const slack = createSlackManager({ engine, db, vault });

// Web is always on (the UI + management API); Slack starts whatever connections exist in the DB.
const channels: Channel[] = [
  createWebChannel({
    engine,
    db,
    skillStore,
    port: WEB_PORT,
    gatewayUrl: GILLY_GATEWAY_URL,
    adminToken: GILLY_ADMIN_TOKEN,
    vault,
    slackManager: slack,
    webUserId: webUser.id,
  }),
  slack,
];

await Promise.all(channels.map((c) => c.start()));
console.log(`⚡️ Gilly control plane ready — channels: ${channels.map((c) => c.name).join(", ")}`);
