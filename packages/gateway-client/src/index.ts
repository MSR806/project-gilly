/**
 * Script-side client for the tooling gateway. Agent-written scripts run inside the sandbox and
 * import this to reach the gateway over HTTP, authenticated by the run-scoped token in the env.
 *
 * Wire contract (matched by the Wave 3 gateway server):
 *   POST ${url}/catalog  { query? }        -> { tools: [{ name, description, inputSchema? }] }
 *   POST ${url}/invoke   { tool, input }    -> the raw tool result (any JSON)
 *   Either route may answer with { error } (e.g. "forbidden", "not_connected") — we throw it.
 */

export type CatalogEntry = { name: string; description: string; inputSchema?: unknown };

type FetchFn = typeof fetch;

function env(): { url: string; token: string } {
  const url = process.env.GILLY_GATEWAY_URL;
  const token = process.env.GILLY_GATEWAY_TOKEN;
  if (!url) throw new Error("GILLY_GATEWAY_URL is not set");
  if (!token) throw new Error("GILLY_GATEWAY_TOKEN is not set");
  return { url, token };
}

async function post(path: string, body: unknown, fetchFn: FetchFn): Promise<unknown> {
  const { url, token } = env();
  const res = await fetchFn(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string } | unknown;
  const error = (data as { error?: string })?.error;
  if (!res.ok || error) throw new Error(error ?? `gateway ${res.status}`);
  return data;
}

/** Search the tools this caller may use. `fetchFn` is injectable only for testing. */
export async function catalog(query?: string, fetchFn: FetchFn = fetch): Promise<CatalogEntry[]> {
  const data = (await post("/catalog", { query }, fetchFn)) as { tools: CatalogEntry[] };
  return data.tools;
}

/** Run one tool and return its raw result. `fetchFn` is injectable only for testing. */
export async function invoke(
  tool: string,
  input: unknown,
  fetchFn: FetchFn = fetch,
): Promise<unknown> {
  return post("/invoke", { tool, input }, fetchFn);
}
