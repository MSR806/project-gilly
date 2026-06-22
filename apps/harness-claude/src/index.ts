import { createHarnessDriver } from "./driver-factory.ts";
import { createServerFromDriver } from "./server.ts";

const driver = createHarnessDriver();
const port = Number(process.env.PORT ?? 8080);
// `idleTimeout: 0` disables Bun's default 10s idle timeout. The agent loop streams one
// NDJSON event at a time, and a single step (a slow tool call, model think-time) can leave
// the socket without bytes for >10s — which would otherwise sever the stream mid-run.
Bun.serve({ port, idleTimeout: 0, fetch: createServerFromDriver(driver).fetch });
console.log(`harness [${driver.name}] listening on :${port}`);
