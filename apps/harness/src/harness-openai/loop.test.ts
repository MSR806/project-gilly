import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationRequest, StreamEvent } from "@gilly/harness-protocol";
import type {
  CodexOptions,
  ThreadEvent,
  ThreadOptions,
  TurnOptions,
  Usage,
} from "@openai/codex-sdk";
import {
  buildCodexOptions,
  buildThreadOptions,
  type CodexFactory,
  codexHomeDir,
  formatCodexError,
  loginAuthPath,
  materializeCodexHome,
  materializeWorkspace,
  runAgentLoop,
  sandboxModeFor,
  streamAgentLoop,
  workspaceDir,
} from "./loop.ts";

const request: InvocationRequest = {
  agent: {
    id: "helper",
    name: "Helper",
    harness: { id: "codex", config: { model: "gpt-5.2" } },
    systemPrompt: "Be concise.",
  },
  userMessage: "Help me",
  workspace: { provider: "local", handle: "session-1" },
};

// Small event builders, mirroring the Claude harness test's inline SDKMessage helpers (init/result).
const threadStarted = (threadId: string): ThreadEvent => ({
  type: "thread.started",
  thread_id: threadId,
});
const turnStarted = (): ThreadEvent => ({ type: "turn.started" });
const agentMessage = (id: string, text: string): ThreadEvent => ({
  type: "item.completed",
  item: { id, type: "agent_message", text },
});
const commandStarted = (id: string, command: string): ThreadEvent => ({
  type: "item.started",
  item: { id, type: "command_execution", command, aggregated_output: "", status: "in_progress" },
});
const commandUpdated = (id: string, command: string, output: string): ThreadEvent => ({
  type: "item.updated",
  item: {
    id,
    type: "command_execution",
    command,
    aggregated_output: output,
    status: "completed",
    exit_code: 0,
  },
});
const commandCompleted = (id: string, command: string, output: string): ThreadEvent => ({
  type: "item.completed",
  item: {
    id,
    type: "command_execution",
    command,
    aggregated_output: output,
    status: "completed",
    exit_code: 0,
  },
});
const fileChange = (
  id: string,
  changes: { path: string; kind: "add" | "delete" | "update" }[],
): ThreadEvent => ({
  type: "item.completed",
  item: { id, type: "file_change", changes, status: "completed" },
});
const mcpToolCall = (id: string, server: string, tool: string, args: unknown): ThreadEvent => ({
  type: "item.completed",
  item: {
    id,
    type: "mcp_tool_call",
    server,
    tool,
    arguments: args,
    result: { content: [], structured_content: {} },
    status: "completed",
  },
});
const turnCompleted = (usage: Usage): ThreadEvent => ({ type: "turn.completed", usage });

// One realistic Codex turn: narration, a shell command, a file edit, and a gateway MCP call.
const fixture: ThreadEvent[] = [
  threadStarted("thread-fixture-1"),
  turnStarted(),
  agentMessage("message-1", "I will inspect and update the file."),
  commandStarted("command-1", "pwd"),
  commandUpdated("command-1", "pwd", "/tmp/workspace\n"),
  commandCompleted("command-1", "pwd", "/tmp/workspace\n"),
  fileChange("change-1", [{ path: "hello.txt", kind: "add" }]),
  mcpToolCall("mcp-1", "gateway", "gateway_invoke", {
    tool: "github.create_issue",
    input: { title: "Hello" },
  }),
  agentMessage("message-2", "Created hello.txt and verified it."),
  turnCompleted({
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 8,
    reasoning_output_tokens: 2,
  }),
];

async function* eventStream(events: ThreadEvent[]) {
  yield* events;
}

async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const output: StreamEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

function fakeCodex(events: ThreadEvent[], calls: { start?: ThreadOptions; resume?: string } = {}) {
  const thread = {
    id: null,
    async runStreamed(_input: string, _options?: TurnOptions) {
      return { events: eventStream(events) };
    },
  };
  return ((_: CodexOptions) => ({
    startThread(options?: ThreadOptions) {
      calls.start = options;
      return thread;
    },
    resumeThread(id: string) {
      calls.resume = id;
      return thread;
    },
  })) as CodexFactory;
}

test("workspace and Codex state use separate stable roots", () => {
  expect(workspaceDir(request, "/workspaces")).toBe("/workspaces/session-1");
  expect(codexHomeDir(request, "/state")).toBe("/state/session-1");
  expect(() =>
    workspaceDir({ ...request, workspace: { provider: "local", handle: "../bad" } }),
  ).toThrow("Unsafe workspace handle");
});

test("sandboxModeFor keeps Bash inside workspace-write", () => {
  expect(sandboxModeFor([])).toBe("read-only");
  expect(sandboxModeFor(["Read"])).toBe("read-only");
  expect(sandboxModeFor(["Write"])).toBe("workspace-write");
  expect(sandboxModeFor(["Bash"])).toBe("workspace-write");
});

test("buildThreadOptions applies the native Codex sandbox", () => {
  expect(buildThreadOptions(request, "/workspace")).toEqual({
    model: "gpt-5.2",
    workingDirectory: "/workspace",
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    sandboxMode: "read-only",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });
  expect(
    buildThreadOptions(
      {
        ...request,
        agent: {
          ...request.agent,
          harness: { id: "codex", config: { model: "gpt-5.4-fast" } },
        },
      },
      "/workspace",
    ).model,
  ).toBe("gpt-5.4-fast");
  expect(
    buildThreadOptions({ ...request, agent: { ...request.agent, tools: ["Write"] } }, "/workspace")
      .sandboxMode,
  ).toBe("workspace-write");
  expect(
    buildThreadOptions({ ...request, agent: { ...request.agent, tools: ["Write"] } }, "/workspace")
      .networkAccessEnabled,
  ).toBe(false);
  expect(
    buildThreadOptions({ ...request, agent: { ...request.agent, tools: ["Bash"] } }, "/workspace")
      .networkAccessEnabled,
  ).toBe(true);
  expect(() =>
    buildThreadOptions(
      {
        ...request,
        agent: {
          ...request.agent,
          harness: { id: "codex", config: { model: "gpt-oss-120b" } },
        },
      },
      "/workspace",
    ),
  ).toThrow("Open-source model support is disabled");
});

test("buildCodexOptions supplies developer instructions and hides secrets from shell commands", () => {
  const options = buildCodexOptions(request, {
    codexHome: "/state/session-1",
    env: { PATH: "/bin", OPENAI_API_KEY: "openai-secret", UNRELATED: "kept" },
  });
  expect(options.apiKey).toBe("openai-secret");
  expect(options.env).toEqual({
    PATH: "/bin",
    OPENAI_API_KEY: "openai-secret",
    CODEX_HOME: "/state/session-1",
  });
  expect(options.config).toEqual({
    developer_instructions: "Be concise.",
    features: {
      apps: false,
      memories: false,
      multi_agent: false,
      remote_plugin: false,
      shell_tool: false,
    },
    shell_environment_policy: {
      include_only: ["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TMPDIR", "USER"],
    },
  });
});

test("buildCodexOptions accepts CODEX_API_KEY as a service-key alias", () => {
  expect(
    buildCodexOptions(request, {
      codexHome: "/state",
      env: { CODEX_API_KEY: "codex-secret" },
    }).apiKey,
  ).toBe("codex-secret");
});

test("explicit Codex serviceTier config enables the fast service tier", () => {
  expect(
    buildCodexOptions(
      {
        ...request,
        agent: {
          ...request.agent,
          harness: { id: "codex", config: { model: "gpt-5.4", serviceTier: "fast" } },
        },
      },
      { codexHome: "/state", env: { OPENAI_API_KEY: "key" } },
    ).config?.service_tier,
  ).toBe("fast");
});

test("formatCodexError hides verbose authentication retries", () => {
  expect(
    formatCodexError(
      new Error(
        "Codex Exec exited with code 1: Reading prompt from stdin...\nERROR failed: 401 Unauthorized\nretry",
      ),
    ),
  ).toBe(
    "OpenAI authentication failed. Set a valid OPENAI_API_KEY in apps/harness/.env and restart the harness.",
  );
});

test("Read and Write do not add Codex tools when Bash is absent", () => {
  const options = buildCodexOptions(
    { ...request, agent: { ...request.agent, tools: ["Read", "Write"] } },
    { codexHome: "/state", env: {} },
  );
  expect(options.config?.features).toMatchObject({ shell_tool: false });
  expect(options.config?.mcp_servers).toBeUndefined();
  expect(
    buildCodexOptions(
      { ...request, agent: { ...request.agent, tools: ["Bash"] } },
      { codexHome: "/state", env: {} },
    ).config?.features,
  ).toMatchObject({ shell_tool: true });
});

test("buildCodexOptions exposes the gateway through a stdio MCP bridge without argv secrets", () => {
  const options = buildCodexOptions(
    { ...request, gateway: { url: "http://gateway", token: "gateway-secret" } },
    {
      codexHome: "/state",
      bridgePath: "/app/gateway-mcp.ts",
      executablePath: "/usr/bin/bun",
      env: {},
    },
  );
  expect(options.env).toMatchObject({
    GILLY_GATEWAY_URL: "http://gateway",
    GILLY_GATEWAY_TOKEN: "gateway-secret",
  });
  expect(options.config?.mcp_servers).toEqual({
    gateway: {
      command: "/usr/bin/bun",
      args: ["/app/gateway-mcp.ts"],
      env_vars: ["GILLY_GATEWAY_URL", "GILLY_GATEWAY_TOKEN"],
      enabled_tools: ["gateway_catalog", "gateway_invoke"],
      default_tools_approval_mode: "approve",
      required: true,
    },
  });
  expect(JSON.stringify(options.config)).not.toContain("gateway-secret");
});

test("materializeWorkspace replaces only Gilly-managed skills and rejects traversal", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gilly-openai-"));
  const state = mkdtempSync(join(tmpdir(), "gilly-openai-state-"));
  mkdirSync(join(cwd, ".agents/skills/native"), { recursive: true });
  writeFileSync(join(cwd, ".agents/skills/native/SKILL.md"), "# Native");
  materializeWorkspace(
    {
      ...request,
      skills: [
        {
          name: "review",
          files: [
            { path: "SKILL.md", contents: "# Review" },
            { path: "references/checks.md", contents: "checks" },
          ],
        },
      ],
    },
    cwd,
    state,
  );
  expect(readFileSync(join(cwd, ".agents/skills/review/SKILL.md"), "utf8")).toBe("# Review");
  expect(readFileSync(join(cwd, ".agents/skills/review/references/checks.md"), "utf8")).toBe(
    "checks",
  );
  materializeWorkspace(request, cwd, state);
  expect(existsSync(join(cwd, ".agents/skills/review"))).toBe(false);
  expect(readFileSync(join(cwd, ".agents/skills/native/SKILL.md"), "utf8")).toBe("# Native");
  expect(() =>
    materializeWorkspace(
      { ...request, skills: [{ name: "review", files: [{ path: "../secret", contents: "x" }] }] },
      cwd,
      state,
    ),
  ).toThrow("Unsafe skill path");
});

test("materialization rejects symlinked managed paths before writing or deleting", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gilly-openai-link-"));
  const outside = mkdtempSync(join(tmpdir(), "gilly-openai-outside-"));
  const state = mkdtempSync(join(tmpdir(), "gilly-openai-state-"));
  symlinkSync(outside, join(cwd, ".agents"));
  expect(() => materializeWorkspace(request, cwd, state)).toThrow("Symbolic links are not allowed");
});

test("materialization rejects duplicate skill bundles before changing managed state", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gilly-openai-duplicate-"));
  const state = mkdtempSync(join(tmpdir(), "gilly-openai-state-"));
  const duplicate = { name: "review", files: [{ path: "SKILL.md", contents: "review" }] };
  expect(() =>
    materializeWorkspace({ ...request, skills: [duplicate, duplicate] }, cwd, state),
  ).toThrow("Duplicate skill: review");
  expect(existsSync(join(cwd, ".agents/skills/review"))).toBe(false);
});

test("materializeCodexHome removes the obsolete permission profile", () => {
  const root = mkdtempSync(join(tmpdir(), "gilly-codex-home-"));
  const home = join(root, "session");
  const fakeLoginRoot = mkdtempSync(join(tmpdir(), "gilly-fake-home-"));
  mkdirSync(home);
  writeFileSync(join(home, "config.toml"), "old profile");

  materializeCodexHome(home, {}, loginAuthPath(fakeLoginRoot));

  expect(existsSync(join(home, "config.toml"))).toBe(false);
});

test("materializeCodexHome forwards a logged-in codex session when no API key is configured", () => {
  const root = mkdtempSync(join(tmpdir(), "gilly-codex-home-"));
  const home = join(root, "session");
  const fakeLoginRoot = mkdtempSync(join(tmpdir(), "gilly-fake-home-"));
  const authPath = loginAuthPath(fakeLoginRoot);
  mkdirSync(join(fakeLoginRoot, ".codex"), { recursive: true });
  writeFileSync(authPath, '{"tokens":"secret"}');

  materializeCodexHome(home, {}, authPath);

  expect(readFileSync(join(home, "auth.json"), "utf8")).toBe('{"tokens":"secret"}');
});

test("materializeCodexHome skips the logged-in session when an API key is configured", () => {
  const root = mkdtempSync(join(tmpdir(), "gilly-codex-home-"));
  const home = join(root, "session");
  const fakeLoginRoot = mkdtempSync(join(tmpdir(), "gilly-fake-home-"));
  const authPath = loginAuthPath(fakeLoginRoot);
  mkdirSync(join(fakeLoginRoot, ".codex"), { recursive: true });
  writeFileSync(authPath, '{"tokens":"secret"}');

  materializeCodexHome(home, { OPENAI_API_KEY: "sk-configured" }, authPath);

  expect(existsSync(join(home, "auth.json"))).toBe(false);
});

test("materializeCodexHome is a no-op when there is no logged-in session either", () => {
  const root = mkdtempSync(join(tmpdir(), "gilly-codex-home-"));
  const home = join(root, "session");
  const fakeLoginRoot = mkdtempSync(join(tmpdir(), "gilly-fake-home-"));

  materializeCodexHome(home, {}, loginAuthPath(fakeLoginRoot));

  expect(existsSync(join(home, "auth.json"))).toBe(false);
});

test("streamAgentLoop translates completed messages and tool items without duplicate snapshots", async () => {
  expect(await collect(streamAgentLoop(request, fakeCodex(fixture)))).toEqual([
    { type: "message", text: "I will inspect and update the file." },
    { type: "tool", name: "Bash", summary: "pwd" },
    { type: "tool", name: "Write", summary: "add hello.txt" },
    { type: "tool", name: "gateway.gateway_invoke", summary: "github.create_issue" },
    {
      type: "done",
      finalText: "Created hello.txt and verified it.",
      harnessSessionId: "thread-fixture-1",
    },
  ]);
});

test("streamAgentLoop reports failed turns", async () => {
  expect(
    await collect(
      streamAgentLoop(
        request,
        fakeCodex([{ type: "turn.failed", error: { message: "model failed" } }]),
      ),
    ),
  ).toEqual([{ type: "error", error: "model failed" }]);
});

test("streamAgentLoop drains through SDK EOF before emitting done", async () => {
  const factory = (() => ({
    startThread() {
      return {
        id: "thread-exit",
        async runStreamed() {
          return {
            events: (async function* () {
              yield* fixture;
              throw new Error("CLI exited after turn.completed");
            })(),
          };
        },
      };
    },
    resumeThread() {
      throw new Error("not used");
    },
  })) as CodexFactory;

  const events = await collect(streamAgentLoop(request, factory));
  expect(events.at(-1)).toEqual({ type: "error", error: "CLI exited after turn.completed" });
  expect(events.some(({ type }) => type === "done")).toBe(false);
});

test("streamAgentLoop preserves a structured terminal error when the CLI then exits nonzero", async () => {
  const factory = (() => ({
    startThread() {
      return {
        id: "thread-quota",
        async runStreamed() {
          return {
            events: (async function* () {
              yield {
                type: "error",
                message: "Quota exceeded. Check billing.",
              } satisfies ThreadEvent;
              throw new Error("Codex Exec exited with code 1: Reading prompt from stdin...");
            })(),
          };
        },
      };
    },
    resumeThread() {
      throw new Error("not used");
    },
  })) as CodexFactory;

  expect(await collect(streamAgentLoop(request, factory))).toEqual([
    { type: "error", error: "Quota exceeded. Check billing." },
  ]);
});

test("runAgentLoop starts or resumes threads and never throws", async () => {
  const startCalls: { start?: ThreadOptions } = {};
  expect((await runAgentLoop(request, fakeCodex(fixture, startCalls))).status).toBe("completed");
  expect(startCalls.start?.workingDirectory).toContain("session-1");

  const resumeCalls: { resume?: string } = {};
  await runAgentLoop(
    { ...request, resumeSessionId: "thread-old" },
    fakeCodex(fixture, resumeCalls),
  );
  expect(resumeCalls.resume).toBe("thread-old");

  const failedFactory = (() => {
    throw new Error("factory failed");
  }) as CodexFactory;
  expect(await runAgentLoop(request, failedFactory)).toEqual({
    status: "error",
    finalText: "",
    harnessSessionId: null,
    error: "factory failed",
  });
});

test("streamAgentLoop aborts Codex only when its consumer cancels early", async () => {
  let signal: AbortSignal | undefined;
  const factory = (() => ({
    startThread() {
      return {
        id: "thread-cancel",
        async runStreamed(_input: string, options?: TurnOptions) {
          signal = options?.signal;
          return {
            events: (async function* () {
              yield {
                type: "item.completed",
                item: {
                  id: "command-cancel",
                  type: "command_execution",
                  command: "pwd",
                  aggregated_output: "",
                  exit_code: 0,
                  status: "completed",
                },
              } satisfies ThreadEvent;
              await new Promise(() => {});
            })(),
          };
        },
      };
    },
    resumeThread() {
      throw new Error("not used");
    },
  })) as CodexFactory;

  const iterator = streamAgentLoop(request, factory)[Symbol.asyncIterator]();
  expect(await iterator.next()).toEqual({
    done: false,
    value: { type: "tool", name: "Bash", summary: "pwd" },
  });
  expect(signal?.aborted).toBe(false);
  await iterator.return?.();
  expect(signal?.aborted).toBe(true);
});

test("an external abort interrupts a pending Codex event read", async () => {
  const factory = (() => ({
    startThread() {
      return {
        id: "thread-pending",
        async runStreamed(_input: string, options?: TurnOptions) {
          return {
            events: (async function* () {
              yield {
                type: "item.completed",
                item: {
                  id: "command-pending",
                  type: "command_execution",
                  command: "pwd",
                  aggregated_output: "",
                  exit_code: 0,
                  status: "completed",
                },
              } satisfies ThreadEvent;
              await new Promise<void>((_resolve, reject) =>
                options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
                  once: true,
                }),
              );
            })(),
          };
        },
      };
    },
    resumeThread() {
      throw new Error("not used");
    },
  })) as CodexFactory;
  const external = new AbortController();
  const iterator = streamAgentLoop(request, factory, external.signal)[Symbol.asyncIterator]();
  await iterator.next();
  const pending = iterator.next();
  await Promise.resolve();
  external.abort();
  expect(await pending).toEqual({
    done: false,
    value: { type: "error", error: "aborted" },
  });
});
