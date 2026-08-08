import { expect, test } from "bun:test";
import {
  ComposioNotConnectedError,
  ComposioProviderError,
  canonicalComposioToolName,
  createComposioService,
} from "./composio.ts";

type ToolkitInput = { cursor?: string; limit?: number; search?: string; isConnected?: boolean };
type ToolkitPage = {
  items: {
    slug: string;
    name: string;
    isNoAuth: boolean;
    connection?: { isActive: boolean };
  }[];
  cursor?: string;
};

function fakeClient(
  log: string[],
  options: {
    redirectUrl?: string | URL;
    toolkitPage?: (input?: ToolkitInput) => ToolkitPage | Promise<ToolkitPage>;
  } = {},
) {
  const redirectUrl =
    "redirectUrl" in options ? options.redirectUrl : new URL("https://connect.composio.dev/link/1");
  const tools = [
    {
      slug: "GMAIL_SEND_EMAIL",
      name: "Send email",
      description: "Send an email",
      inputParameters: { type: "object", properties: {} },
      toolkit: { slug: "gmail" },
    },
    { slug: "HACKERNEWS_GET_USER", name: "Get user", toolkit: { slug: "hackernews" } },
    { slug: "COMPOSIO_EXECUTE_TOOL", name: "Execute tool", toolkit: { slug: "composio" } },
    {
      slug: "COMPOSIO_SEARCH_EXA",
      name: "Search Exa",
      toolkit: { slug: "composio_search" },
    },
    { slug: "GMAIL_FAIL", name: "Fail", toolkit: { slug: "gmail" } },
  ];
  return {
    sessions: {
      async create(userId: string) {
        log.push(`create:${userId}`);
        return {
          async toolkits(input?: ToolkitInput) {
            log.push(`toolkits:${input?.search ?? ""}`);
            if (options.toolkitPage) return options.toolkitPage(input);
            const items = [
              { slug: "gmail", name: "Gmail", isNoAuth: false, connection: { isActive: true } },
              { slug: "hackernews", name: "Hacker News", isNoAuth: true },
              { slug: "composio", name: "Composio", isNoAuth: true },
              { slug: "composio_search", name: "Composio Search", isNoAuth: true },
              { slug: "slack", name: "Slack", isNoAuth: false },
            ];
            return {
              items: input?.isConnected ? items.filter((item) => item.connection?.isActive) : items,
            };
          },
          async authorize(slug: string, options: { callbackUrl: string }) {
            log.push(`authorize:${slug}:${options.callbackUrl}`);
            return { redirectUrl };
          },
          async execute(slug: string) {
            log.push(`execute:${slug}`);
            return slug === "GMAIL_FAIL"
              ? { error: "No connected account" }
              : { data: { ok: true } };
          },
        };
      },
    },
    toolkits: {
      async get(slug: string) {
        return {
          slug,
          name: slug === "gmail" ? "Gmail" : slug,
          noAuth: slug === "hackernews",
          meta: { description: `${slug} tools`, logo: `${slug}.png`, toolsCount: 2 },
        };
      },
    },
    tools: {
      async getRawComposioTools(query: { toolkits: string[]; limit: number }) {
        const toolkit = query.toolkits[0] as string;
        log.push(`raw:${toolkit}:${query.limit}`);
        return tools.filter((tool) => tool.toolkit.slug === toolkit);
      },
    },
  };
}

test("canonical names remove the toolkit prefix", () => {
  expect(canonicalComposioToolName("gmail", "GMAIL_SEND_EMAIL")).toBe("gmail.send_email");
});

test("service returns connected tools immediately, warms no-auth tools, and recreates keyed sessions", async () => {
  const log: string[] = [];
  let key = "key-1";
  const service = createComposioService({
    getApiKey: () => key,
    userId: "gilly-shared",
    createClient: () => fakeClient(log),
  });

  expect((await service.listTools()).map((tool) => tool.name)).toEqual([
    "gmail.send_email",
    "gmail.fail",
  ]);
  await Bun.sleep(0);
  expect((await service.listTools()).map((tool) => tool.name)).toEqual([
    "gmail.send_email",
    "gmail.fail",
    "hackernews.get_user",
  ]);
  expect(log.filter((entry) => entry === "raw:hackernews:1000")).toHaveLength(1);
  const page = await service.listToolkits({ query: "mail" });
  expect(page.configured).toBe(true);
  expect(page.items[0]).toEqual({
    slug: "gmail",
    name: "Gmail",
    description: "gmail tools",
    logo: "gmail.png",
    toolsCount: 2,
    connected: true,
    noAuth: false,
  });
  expect(page.items.some((item) => item.slug.startsWith("composio"))).toBe(false);
  expect(await service.authorize("gmail", "https://gilly.example/callback")).toBe(
    "https://connect.composio.dev/link/1",
  );
  expect(await service.execute("GMAIL_SEND_EMAIL", {})).toEqual({ ok: true });
  key = "key-2";
  await service.listTools();
  expect(log.filter((entry) => entry === "create:gilly-shared")).toHaveLength(2);
});

test("connected discovery is not blocked by the full no-auth toolkit scan", async () => {
  const inputs: ToolkitInput[] = [];
  const service = createComposioService({
    getApiKey: () => "key",
    userId: "gilly-shared",
    createClient: () =>
      fakeClient([], {
        toolkitPage: (input) => {
          inputs.push(input ?? {});
          if (!input?.isConnected) return new Promise<ToolkitPage>(() => {});
          return {
            items: [
              {
                slug: "gmail",
                name: "Gmail",
                isNoAuth: false,
                connection: { isActive: true },
              },
            ],
          };
        },
      }),
  });

  expect((await service.listTools()).map((tool) => tool.name)).toEqual([
    "gmail.send_email",
    "gmail.fail",
  ]);
  expect(inputs[0]?.isConnected).toBe(true);
});

test("a rejected cached session is cleared so the next call retries", async () => {
  let attempts = 0;
  const client = fakeClient([]);
  const create = client.sessions.create;
  client.sessions.create = async (userId: string) => {
    attempts += 1;
    if (attempts === 1) throw new Error("session failed");
    return create(userId);
  };
  const service = createComposioService({
    getApiKey: () => "key",
    userId: "gilly-shared",
    createClient: () => client,
  });

  await expect(service.listTools()).rejects.toThrow("session failed");
  await service.listTools();
  expect(attempts).toBe(2);
});

test("a rejected old session does not clear the replacement for a new key", async () => {
  let key = "old";
  const oldClient = fakeClient([]);
  const rejection = { reject: (_error: Error) => {} };
  oldClient.sessions.create = () =>
    new Promise((_, reject) => {
      rejection.reject = reject;
    });
  let clients = 0;
  const service = createComposioService({
    getApiKey: () => key,
    userId: "gilly-shared",
    createClient: (apiKey) => {
      clients += 1;
      return apiKey === "old" ? oldClient : fakeClient([]);
    },
  });

  const oldRequest = service.listTools();
  key = "new";
  await service.listTools();
  rejection.reject(new Error("old session failed"));
  await expect(oldRequest).rejects.toThrow("old session failed");
  await service.listTools();
  expect(clients).toBe(2);
});

test("a stale no-auth scan does not block warming after an API key change", async () => {
  let key = "old";
  let releaseOld = () => {};
  let releaseNew = () => {};
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const newGate = new Promise<void>((resolve) => {
    releaseNew = resolve;
  });
  const oldClient = fakeClient([], {
    toolkitPage: async (input) => {
      if (!input?.isConnected) return new Promise<ToolkitPage>(() => {});
      await oldGate;
      return {
        items: [
          {
            slug: "gmail",
            name: "Gmail",
            isNoAuth: false,
            connection: { isActive: true },
          },
        ],
      };
    },
  });
  const newClient = fakeClient([], {
    toolkitPage: async (input) => {
      if (!input?.isConnected) {
        return { items: [{ slug: "hackernews", name: "Hacker News", isNoAuth: true }] };
      }
      await newGate;
      return {
        items: [
          {
            slug: "gmail",
            name: "Gmail",
            isNoAuth: false,
            connection: { isActive: true },
          },
        ],
      };
    },
  });
  const service = createComposioService({
    getApiKey: () => key,
    userId: "gilly-shared",
    createClient: (apiKey) => (apiKey === "old" ? oldClient : newClient),
  });

  const oldRequest = service.listTools();
  key = "new";
  const newRequest = service.listTools();
  releaseOld();
  await oldRequest;
  releaseNew();
  await newRequest;
  await Bun.sleep(0);
  expect((await service.listTools()).map((tool) => tool.name)).toContain("hackernews.get_user");
});

test("connected toolkit discovery stops on a non-advancing cursor", async () => {
  let pages = 0;
  const service = createComposioService({
    getApiKey: () => "key",
    userId: "gilly-shared",
    createClient: () =>
      fakeClient([], {
        toolkitPage: (input) => {
          if (!input?.isConnected) return { items: [] };
          pages += 1;
          return { items: [], cursor: "same" };
        },
      }),
  });

  expect(await service.listTools()).toEqual([]);
  expect(pages).toBe(2);
});

test("connected toolkit discovery has a maximum page count", async () => {
  let pages = 0;
  const service = createComposioService({
    getApiKey: () => "key",
    userId: "gilly-shared",
    createClient: () =>
      fakeClient([], {
        toolkitPage: (input) => {
          if (!input?.isConnected) return { items: [] };
          pages += 1;
          return { items: [], cursor: `page-${pages}` };
        },
      }),
  });

  expect(await service.listTools()).toEqual([]);
  expect(pages).toBe(100);
});

test("service reports missing connections distinctly", async () => {
  const service = createComposioService({
    getApiKey: () => "key",
    userId: "gilly-shared",
    createClient: () => fakeClient([]),
  });
  await expect(service.execute("GMAIL_FAIL", {})).rejects.toBeInstanceOf(ComposioNotConnectedError);
});

test("unconfigured service returns structured toolkit status without creating a client", async () => {
  const service = createComposioService({
    getApiKey: () => undefined,
    userId: "gilly-shared",
    createClient: () => {
      throw new Error("must not create");
    },
  });
  expect(await service.listToolkits({})).toEqual({ configured: false, items: [] });
});

test("malformed stored credentials are recoverable as unconfigured", async () => {
  const service = createComposioService({
    getApiKey: () => {
      throw new Error("decrypt failed");
    },
    userId: "gilly-shared",
    createClient: () => {
      throw new Error("must not create");
    },
  });

  expect(service.configured()).toBe(false);
  expect(await service.listToolkits({})).toEqual({ configured: false, items: [] });
});

test("authorize requires an absolute HTTPS redirect URL", async () => {
  for (const redirectUrl of [undefined, "/relative", "http://connect.composio.dev/link/1"]) {
    const service = createComposioService({
      getApiKey: () => "key",
      userId: "gilly-shared",
      createClient: () => fakeClient([], { redirectUrl }),
    });
    await expect(
      service.authorize("gmail", "https://gilly.example/callback"),
    ).rejects.toBeInstanceOf(ComposioProviderError);
  }
});
