import { createServer } from "./server.ts";

const port = Number(process.env.PORT ?? 8080);
Bun.serve({ port, fetch: createServer().fetch });
console.log(`harness-claude listening on :${port}`);
