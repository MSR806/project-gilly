import { afterEach, beforeEach, expect, test } from "bun:test";
import { catalog, invoke } from "./index.ts";

beforeEach(() => {
  process.env.GILLY_GATEWAY_URL = "http://gw.test";
  process.env.GILLY_GATEWAY_TOKEN = "tok-123";
});
afterEach(() => {
  process.env.GILLY_GATEWAY_URL = undefined;
  process.env.GILLY_GATEWAY_TOKEN = undefined;
});

function fakeFetch(body: unknown, ok = true, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("catalog posts to /catalog with Bearer header and returns tools", async () => {
  const tools = [{ name: "branch.query", description: "d" }];
  const { fn, calls } = fakeFetch({ tools });
  const result = await catalog("branch", fn);
  expect(result).toEqual(tools);
  expect(calls[0]?.url).toBe("http://gw.test/catalog");
  expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer tok-123");
  expect(calls[0]?.init.body).toBe(JSON.stringify({ query: "branch" }));
});

test("invoke throws when the body carries { error }", async () => {
  const { fn } = fakeFetch({ error: "forbidden" });
  expect(invoke("branch.query", {}, fn)).rejects.toThrow("forbidden");
});

test("missing env var throws", async () => {
  process.env.GILLY_GATEWAY_URL = undefined;
  const { fn } = fakeFetch({ tools: [] });
  expect(catalog(undefined, fn)).rejects.toThrow("GILLY_GATEWAY_URL is not set");
});
