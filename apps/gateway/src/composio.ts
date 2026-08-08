import { Composio } from "@composio/core";

const TOOLKIT_PAGE_SIZE = 50;
const TOOLKIT_MAX_PAGES = 100;
const TOOL_PAGE_SIZE = 1_000;

export type ComposioTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
  source: "composio";
  toolkit: string;
  connected: boolean;
  upstreamSlug: string;
};

export type ComposioToolkit = {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  toolsCount: number;
  connected: boolean;
  noAuth: boolean;
};

export type ComposioToolkitPage = {
  configured: boolean;
  items: ComposioToolkit[];
  nextCursor?: string;
};

type ToolkitState = {
  slug: string;
  name: string;
  logo?: string;
  isNoAuth: boolean;
  connection?: { isActive: boolean };
};

type RawToolkit = {
  slug: string;
  name: string;
  noAuth?: boolean;
  meta: { description?: string; logo?: string; toolsCount?: number };
};

type RawTool = {
  slug: string;
  name: string;
  description?: string;
  inputParameters?: unknown;
  toolkit?: { slug: string };
};

type ComposioSession = {
  toolkits(options?: {
    cursor?: string;
    limit?: number;
    search?: string;
    isConnected?: boolean;
  }): Promise<{ items: ToolkitState[]; cursor?: string }>;
  authorize(
    slug: string,
    options: { callbackUrl: string },
  ): Promise<{ redirectUrl?: string | URL }>;
  execute(
    upstreamSlug: string,
    input: Record<string, unknown>,
  ): Promise<{ data?: unknown; error?: unknown }>;
};

type ComposioClient = {
  sessions: {
    create(userId: string, config: { manageConnections: false }): Promise<ComposioSession>;
  };
  toolkits: { get(slug: string): Promise<RawToolkit> };
  tools: {
    getRawComposioTools(query: {
      toolkits: string[];
      limit: number;
      important: false;
    }): Promise<RawTool[]>;
  };
};

export interface ComposioService {
  configured(): boolean;
  listTools(): Promise<ComposioTool[]>;
  listToolkits(input: { query?: string; cursor?: string }): Promise<ComposioToolkitPage>;
  authorize(slug: string, callbackUrl: string): Promise<string>;
  execute(upstreamSlug: string, input: unknown): Promise<unknown>;
}

export class ComposioNotConfiguredError extends Error {}
export class ComposioNotConnectedError extends Error {}
export class ComposioProviderError extends Error {}

const providerMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : JSON.stringify(error);

const isMissingConnection = (message: string) =>
  /not connected|connected account|connection required|authentication required/i.test(message);

/** Convert an upstream slug into Gilly's provider-neutral dotted name. */
export function canonicalComposioToolName(toolkit: string, upstreamSlug: string): string {
  const prefix = `${toolkit.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_`;
  const action = upstreamSlug.startsWith(prefix) ? upstreamSlug.slice(prefix.length) : upstreamSlug;
  return `${toolkit.toLowerCase()}.${action.toLowerCase()}`;
}

export function createComposioService(deps: {
  getApiKey: () => string | undefined;
  userId: string;
  createClient?: (apiKey: string) => ComposioClient;
}): ComposioService {
  const createClient =
    deps.createClient ??
    ((apiKey: string) =>
      new Composio({ apiKey, allowTracking: false, disableVersionCheck: true }) as ComposioClient);
  type ServiceState = {
    apiKey: string;
    client: ComposioClient;
    session: Promise<ComposioSession>;
    noAuthToolkits?: string[];
    noAuthDiscovery?: Promise<void>;
  };
  let current: ServiceState | undefined;

  function configured(): boolean {
    try {
      return !!deps.getApiKey();
    } catch {
      return false;
    }
  }

  function apiKey(): string {
    const key = deps.getApiKey();
    if (!key) throw new ComposioNotConfiguredError("Composio is not configured");
    return key;
  }

  function state() {
    const key = apiKey();
    if (!current || current.apiKey !== key) {
      const client = createClient(key);
      const next = {
        apiKey: key,
        client,
        session: client.sessions.create(deps.userId, { manageConnections: false }),
      };
      current = next;
      void next.session.catch(() => {
        if (current === next) current = undefined;
      });
    }
    return current;
  }

  async function connectedToolkits(entry: ServiceState): Promise<string[]> {
    const session = await entry.session;
    const slugs: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < TOOLKIT_MAX_PAGES; pageNumber += 1) {
      const page = await session.toolkits({ cursor, limit: TOOLKIT_PAGE_SIZE, isConnected: true });
      for (const item of page.items) {
        if (!item.slug.startsWith("composio") && item.connection?.isActive) {
          slugs.push(item.slug);
        }
      }
      if (!page.cursor || page.cursor === cursor) break;
      cursor = page.cursor;
    }
    return slugs;
  }

  async function discoverNoAuthToolkits(entry: ServiceState): Promise<string[]> {
    const session = await entry.session;
    const slugs: string[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < TOOLKIT_MAX_PAGES; pageNumber += 1) {
      const page = await session.toolkits({ cursor, limit: TOOLKIT_PAGE_SIZE });
      for (const item of page.items) {
        if (!item.slug.startsWith("composio") && item.isNoAuth) slugs.push(item.slug);
      }
      if (!page.cursor || page.cursor === cursor) break;
      cursor = page.cursor;
    }
    return slugs;
  }

  function warmNoAuthToolkits(entry: ServiceState) {
    if (entry.noAuthToolkits !== undefined || entry.noAuthDiscovery) return;
    const pending = discoverNoAuthToolkits(entry).then((slugs) => {
      entry.noAuthToolkits = slugs;
    });
    entry.noAuthDiscovery = pending;
    const clear = () => {
      if (entry.noAuthDiscovery === pending) entry.noAuthDiscovery = undefined;
    };
    void pending.then(clear, clear);
  }

  async function listTools(): Promise<ComposioTool[]> {
    const entry = state();
    const connected = await connectedToolkits(entry);
    warmNoAuthToolkits(entry);
    const toolkits = [...new Set([...connected, ...(entry.noAuthToolkits ?? [])])];
    if (toolkits.length === 0) return [];
    const raw = (
      await Promise.all(
        toolkits.map((toolkit) =>
          entry.client.tools.getRawComposioTools({
            toolkits: [toolkit],
            limit: TOOL_PAGE_SIZE,
            important: false,
          }),
        ),
      )
    ).flat();
    const byName = new Map<string, ComposioTool>();
    for (const tool of raw) {
      const toolkit = tool.toolkit?.slug;
      if (!toolkit) continue;
      const name = canonicalComposioToolName(toolkit, tool.slug);
      if (byName.has(name)) continue;
      byName.set(name, {
        name,
        description: tool.description ?? tool.name,
        ...(tool.inputParameters ? { inputSchema: tool.inputParameters } : {}),
        source: "composio",
        toolkit,
        connected: true,
        upstreamSlug: tool.slug,
      });
    }
    return [...byName.values()];
  }

  return {
    configured,
    listTools,
    async listToolkits(input) {
      if (!configured()) return { configured: false, items: [] };
      const { client, session } = state();
      const page = await (await session).toolkits({
        ...(input.query ? { search: input.query } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: TOOLKIT_PAGE_SIZE,
      });
      const items = page.items.filter((item) => !item.slug.startsWith("composio"));
      const details = await Promise.all(items.map((item) => client.toolkits.get(item.slug)));
      return {
        configured: true,
        items: items.map((item, index) => {
          const detail = details[index] as RawToolkit;
          return {
            slug: item.slug,
            name: detail.name,
            description: detail.meta.description ?? "",
            ...((detail.meta.logo ?? item.logo) ? { logo: detail.meta.logo ?? item.logo } : {}),
            toolsCount: detail.meta.toolsCount ?? 0,
            connected: item.isNoAuth || !!item.connection?.isActive,
            noAuth: item.isNoAuth || !!detail.noAuth,
          };
        }),
        ...(page.cursor ? { nextCursor: page.cursor } : {}),
      };
    },
    async authorize(slug, callbackUrl) {
      const session = await state().session;
      const request = await session.authorize(slug, { callbackUrl });
      if (!request.redirectUrl)
        throw new ComposioProviderError("Composio returned no redirect URL");
      let redirect: URL;
      try {
        redirect = new URL(String(request.redirectUrl));
      } catch {
        throw new ComposioProviderError("Composio returned an invalid redirect URL");
      }
      if (redirect.protocol !== "https:") {
        throw new ComposioProviderError("Composio returned an insecure redirect URL");
      }
      return redirect.toString();
    },
    async execute(upstreamSlug, input) {
      let result: { data?: unknown; error?: unknown };
      try {
        result = await (await state().session).execute(
          upstreamSlug,
          (input as Record<string, unknown>) ?? {},
        );
      } catch (error) {
        if (error instanceof ComposioNotConfiguredError) throw error;
        const message = providerMessage(error);
        if (isMissingConnection(message)) throw new ComposioNotConnectedError(message);
        throw new ComposioProviderError(message);
      }
      if (result.error) {
        const message = providerMessage(result.error);
        if (isMissingConnection(message)) throw new ComposioNotConnectedError(message);
        throw new ComposioProviderError(message);
      }
      return result.data;
    },
  };
}
