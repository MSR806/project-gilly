import type { SlackConnection, Vault } from "@gilly/core";
import { type Db, listSlackConnections, setSlackConnectionStatus } from "@gilly/db";
import type { App } from "@slack/bolt";
import type { createEngine } from "../engine.ts";
import type { Channel } from "./channel.ts";
import { buildSlackApp } from "./slack.ts";

/** A Channel that owns N Slack connections and can start/stop them live (no restart to reconfigure). */
export type SlackManager = Channel & {
  /** Start a newly-created connection. */
  add(conn: SlackConnection): Promise<void>;
  /** Stop and forget a connection. */
  remove(id: string): Promise<void>;
  /** Restart a connection after its tokens or bound agent changed. */
  restart(conn: SlackConnection): Promise<void>;
};

/**
 * Manages the running Bolt apps, one per Slack connection. Tokens are decrypted only here, at start.
 * A connection that fails to start is recorded as `status: "error"` and skipped — one bad connection
 * never crashes boot or blocks the others.
 */
export function createSlackManager(deps: {
  engine: ReturnType<typeof createEngine>;
  db: Db;
  vault: Vault;
}): SlackManager {
  const running = new Map<string, App>();

  async function startOne(conn: SlackConnection): Promise<void> {
    if (running.has(conn.id)) await stopOne(conn.id);
    try {
      const app = buildSlackApp({
        engine: deps.engine,
        db: deps.db,
        botToken: deps.vault.decrypt(conn.botToken),
        appToken: deps.vault.decrypt(conn.appToken),
        agentId: conn.agentId,
      });
      await app.start();
      running.set(conn.id, app);
      setSlackConnectionStatus(deps.db, conn.id, "active");
      console.log(`[slack] connection "${conn.name}" (${conn.id}) started → agent ${conn.agentId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSlackConnectionStatus(deps.db, conn.id, "error", msg);
      console.error(`[slack] connection "${conn.name}" (${conn.id}) failed to start:`, msg);
    }
  }

  async function stopOne(id: string): Promise<void> {
    const app = running.get(id);
    if (!app) return;
    running.delete(id);
    await app.stop().catch((e) => console.warn(`[slack] stop ${id} failed:`, String(e)));
  }

  return {
    name: "slack",
    start: async () => {
      const conns = listSlackConnections(deps.db).filter((c) => c.status !== "disabled");
      await Promise.all(conns.map(startOne));
      console.log(`[slack] started ${running.size}/${conns.length} connection(s)`);
    },
    add: startOne,
    remove: stopOne,
    restart: async (conn) => {
      await stopOne(conn.id);
      await startOne(conn);
    },
  };
}
