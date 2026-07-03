import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDb } from "@gilly/db";
import { makeRealMcp } from "./mcp.ts";
import { createGatewayServer } from "./server.ts";
import { makeVault } from "./vault.ts";

const repoRoot = resolve(import.meta.dir, "../../..");
const DATABASE_PATH = resolve(repoRoot, process.env.DATABASE_PATH ?? "data/gilly.db");
const PORT = Number(process.env.PORT ?? 4100);
// Public base URL the gateway is reachable at — must match what Atlassian redirects back to.
const GATEWAY_URL = process.env.GILLY_GATEWAY_URL ?? `http://localhost:${PORT}`;
// Web app base URL to return to after an OAuth connect completes.
const WEB_URL = process.env.GILLY_WEB_URL ?? "http://localhost:3000";

const vaultKey = process.env.GILLY_VAULT_KEY;
if (!vaultKey) throw new Error("GILLY_VAULT_KEY is required");
const adminToken = process.env.GILLY_ADMIN_TOKEN;
if (!adminToken) throw new Error("GILLY_ADMIN_TOKEN is required");

mkdirSync(dirname(DATABASE_PATH), { recursive: true });
const db = createDb(DATABASE_PATH);
const vault = makeVault(vaultKey);
const mcp = makeRealMcp({ db, vault, gatewayUrl: GATEWAY_URL });
const fetch = createGatewayServer({
  db,
  vault,
  adminToken,
  gatewayUrl: GATEWAY_URL,
  webUrl: WEB_URL,
  mcp,
});

Bun.serve({ port: PORT, fetch });
console.log(`⚡️ Gilly gateway listening on :${PORT}`);
