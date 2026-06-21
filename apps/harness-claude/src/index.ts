import { resolveDriver } from "./resolve-driver.ts";
import { createServer } from "./server.ts";

const port = Number(process.env.PORT ?? 8080);
const driver = await resolveDriver();

// `idleTimeout: 0` disables Bun's default 10s idle timeout. The agent loop streams one
// NDJSON event at a time, and a single step (a slow tool call, model think-time) can leave
// the socket without bytes for >10s — which would otherwise sever the stream mid-run.
Bun.serve({ port, idleTimeout: 0, fetch: createServer(driver).fetch });
console.log(`harness-claude (driver: ${driver.name}) listening on :${port}`);
