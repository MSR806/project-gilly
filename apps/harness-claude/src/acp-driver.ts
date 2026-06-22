import type {
  AnyRequest,
  InitializeResponse,
  NewSessionResponse,
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import { AGENT_METHODS, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
import type { HarnessDriver } from "./driver.ts";

/**
 * The transport abstraction AcpDriver uses to talk to an ACP-compatible process.
 * In production this wraps a child process's stdin/stdout; in tests it's a simple fake.
 *
 * NOTE: We keep this thin stdio wrapper rather than using the SDK's `ndJsonStream` +
 * `ClientApp.connectWith()` because:
 * 1. The SDK's `ClientApp` dispatches notifications via registered handlers and does not
 *    expose a pull-based async iterator we can interleave with request/response awaiting.
 * 2. Our driver needs to read lines sequentially — wait for a specific RPC response while
 *    buffering streaming notifications — which maps naturally to an AsyncIterator<string>.
 * 3. The SDK's `ndJsonStream` requires `ReadableStream<Uint8Array>` / `WritableStream<Uint8Array>`
 *    (web streams), while Bun.spawn().stdout exposes a different ReadableStream shape.
 *
 * We still import and use all official ACP types, constants, and protocol version from the
 * SDK so wire-format correctness is guaranteed by the type system.
 */
export interface AcpTransport {
  send(msg: string): void;
  receive(): AsyncIterable<string>;
  close(): void;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

let nextId = 1;

/** Reset the internal request-id counter (for deterministic tests). */
export function resetIdCounter(): void {
  nextId = 1;
}

/** Build the `initialize` JSON-RPC request. */
export function buildInitialize(): AnyRequest {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method: AGENT_METHODS.initialize,
    params: {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "gilly-harness", version: "1.0.0" },
    },
  };
}

/** Build a `session/new` request. */
export function buildSessionNew(cwd: string): AnyRequest {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method: AGENT_METHODS.session_new,
    params: { cwd, mcpServers: [] },
  };
}

/** Build a `session/resume` request. */
export function buildSessionResume(sessionId: string, cwd: string): AnyRequest {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method: AGENT_METHODS.session_resume,
    params: { sessionId, cwd, mcpServers: [] },
  };
}

/** Build a `session/load` request. */
export function buildSessionLoad(sessionId: string, cwd: string): AnyRequest {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method: AGENT_METHODS.session_load,
    params: { sessionId, cwd, mcpServers: [] },
  };
}

/** Build a `session/prompt` request. */
export function buildSessionPrompt(sessionId: string, text: string): AnyRequest {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method: AGENT_METHODS.session_prompt,
    params: { sessionId, prompt: [{ type: "text", text }] },
  };
}

/**
 * Pure: parses a single NDJSON line from the ACP process stdout into a StreamEvent,
 * or null if the line isn't a recognized streaming notification.
 *
 * ACP session/update notifications carry a `SessionNotification` with a `SessionUpdate`
 * discriminated union. We map:
 * - `agent_message_chunk` with text content → `{ type: "token", text }`
 * - `tool_call` → `{ type: "tool", name, summary }`
 *
 * Also handles JSON-RPC result/error responses.
 */
export function parseAcpLine(
  line: string,
): StreamEvent | { _rpcResult: unknown; id: number } | { _rpcError: string; id: number } | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (msg.jsonrpc !== "2.0") return null;

  // JSON-RPC notification — session/update
  if (msg.method === "session/update" && msg.params) {
    const params = msg.params as SessionNotification;
    const update: SessionUpdate = params.update;
    const sessionUpdate = update.sessionUpdate;

    if (sessionUpdate === "agent_message_chunk") {
      const content = update.content;
      if (content.type === "text" && typeof content.text === "string") {
        return { type: "token", text: content.text };
      }
    }

    if (sessionUpdate === "tool_call") {
      const title = update.title;
      const kind = update.kind ?? "";
      const status = update.status ?? "";
      const summary = [kind, status].filter(Boolean).join(" — ");
      return { type: "tool", name: title, summary };
    }

    return null;
  }

  // JSON-RPC result
  if (typeof msg.id === "number" && msg.result !== undefined) {
    return { _rpcResult: msg.result, id: msg.id };
  }

  // JSON-RPC error
  if (typeof msg.id === "number" && msg.error) {
    const err = msg.error as { message?: string };
    return {
      _rpcError: typeof err.message === "string" ? err.message : "unknown",
      id: msg.id,
    };
  }

  return null;
}

// ─── Transport ────────────────────────────────────────────────────────────────

/**
 * Creates a stdio transport that spawns an ACP-compatible process.
 * The process receives JSON-RPC on stdin (newline-delimited) and emits
 * JSON-RPC notifications + results on stdout.
 */
export function createStdioTransport(command: string, args: string[] = []): AcpTransport {
  const proc = Bun.spawn([command, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  return {
    send(msg: string) {
      proc.stdin.write(`${msg}\n`);
    },
    async *receive() {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) yield line;
          }
        }
      } finally {
        reader.releaseLock();
      }
      const rest = buffer.trim();
      if (rest) yield rest;
    },
    close() {
      proc.stdin.end();
      proc.kill();
    },
  };
}

// ─── Driver ───────────────────────────────────────────────────────────────────

/**
 * ACP harness driver: speaks the Agent Client Protocol session flow over stdio JSON-RPC.
 * Uses types and constants from @agentclientprotocol/sdk to ensure wire-format correctness.
 * Flow: initialize → session/new|resume|load → session/prompt → stream session/update.
 */
export class AcpDriver implements HarnessDriver {
  readonly name = "acp";
  private readonly createTransport: () => AcpTransport;

  constructor(createTransport?: () => AcpTransport) {
    const cmd = process.env.ACP_COMMAND ?? "acp-agent";
    const args = process.env.ACP_ARGS?.split(" ").filter(Boolean) ?? [];
    this.createTransport = createTransport ?? (() => createStdioTransport(cmd, args));
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    const transport = this.createTransport();
    const lineIter = transport.receive()[Symbol.asyncIterator]();
    try {
      const sessionId = await this.setupSession(transport, lineIter, req);
      return await this.runPrompt(transport, lineIter, sessionId, req.userMessage);
    } catch (err) {
      return { status: "error", finalText: "", harnessSessionId: null, error: String(err) };
    } finally {
      transport.close();
    }
  }

  async *invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent> {
    const transport = this.createTransport();
    const lineIter = transport.receive()[Symbol.asyncIterator]();
    try {
      const sessionId = await this.setupSession(transport, lineIter, req);
      yield* this.streamPrompt(transport, lineIter, sessionId, req.userMessage);
    } catch (err) {
      yield { type: "error", error: String(err) };
    } finally {
      transport.close();
    }
  }

  /**
   * Performs the initialize + session creation handshake.
   * Returns the ACP sessionId to use for prompting.
   */
  private async setupSession(
    transport: AcpTransport,
    lineIter: AsyncIterator<string>,
    req: InvocationRequest,
  ): Promise<string> {
    const cwd = req.workspace?.handle ?? "/workspace";

    // 1. Initialize
    const initReq = buildInitialize();
    transport.send(JSON.stringify(initReq));
    const initResult = await this.waitForResult<InitializeResponse>(lineIter, initReq.id as number);

    // 2. Session creation/restoration
    // SDK type: sessionCapabilities.resume is an object (SessionResumeCapabilities) when supported
    const canResume = initResult.agentCapabilities?.sessionCapabilities?.resume != null;
    const canLoad = initResult.agentCapabilities?.loadSession === true;

    let sessionReq: AnyRequest;
    if (req.resumeSessionId && canResume) {
      sessionReq = buildSessionResume(req.resumeSessionId, cwd);
    } else if (req.resumeSessionId && canLoad) {
      sessionReq = buildSessionLoad(req.resumeSessionId, cwd);
    } else {
      sessionReq = buildSessionNew(cwd);
    }
    transport.send(JSON.stringify(sessionReq));
    const sessionResult = await this.waitForResult<NewSessionResponse>(
      lineIter,
      sessionReq.id as number,
    );

    // For session/resume and session/load, we reuse the requested sessionId.
    // For session/new, we use the returned sessionId.
    return sessionResult.sessionId ?? req.resumeSessionId ?? "unknown";
  }

  /** Wait for a JSON-RPC result with the given id, ignoring notifications. */
  private async waitForResult<T>(iter: AsyncIterator<string>, expectedId: number): Promise<T> {
    for (;;) {
      const { done, value } = await iter.next();
      if (done) throw new Error("ACP transport closed before result received");
      const parsed = parseAcpLine(value);
      if (!parsed) continue;
      if ("_rpcError" in parsed && parsed.id === expectedId) {
        throw new Error(parsed._rpcError);
      }
      if ("_rpcResult" in parsed && parsed.id === expectedId) {
        return parsed._rpcResult as T;
      }
      // skip notifications/other ids during handshake
    }
  }

  /** Send session/prompt and collect the final result (non-streaming). */
  private async runPrompt(
    transport: AcpTransport,
    lineIter: AsyncIterator<string>,
    sessionId: string,
    text: string,
  ): Promise<InvocationResult> {
    const promptReq = buildSessionPrompt(sessionId, text);
    transport.send(JSON.stringify(promptReq));

    let finalText = "";
    for (;;) {
      const { done, value } = await lineIter.next();
      if (done) break;
      const parsed = parseAcpLine(value);
      if (!parsed) continue;
      if ("type" in parsed) {
        if (parsed.type === "token") finalText += parsed.text;
        continue;
      }
      if ("_rpcError" in parsed && parsed.id === (promptReq.id as number)) {
        return { status: "error", finalText: "", harnessSessionId: null, error: parsed._rpcError };
      }
      if ("_rpcResult" in parsed && parsed.id === (promptReq.id as number)) {
        return { status: "completed", finalText, harnessSessionId: sessionId, error: null };
      }
    }
    return {
      status: "error",
      finalText: "",
      harnessSessionId: null,
      error: "ACP process ended without a prompt result",
    };
  }

  /** Send session/prompt and yield StreamEvents as they arrive. */
  private async *streamPrompt(
    transport: AcpTransport,
    lineIter: AsyncIterator<string>,
    sessionId: string,
    text: string,
  ): AsyncIterable<StreamEvent> {
    const promptReq = buildSessionPrompt(sessionId, text);
    transport.send(JSON.stringify(promptReq));

    let finalText = "";
    for (;;) {
      const { done, value } = await lineIter.next();
      if (done) break;
      const parsed = parseAcpLine(value);
      if (!parsed) continue;
      if ("type" in parsed) {
        if (parsed.type === "token") finalText += parsed.text;
        yield parsed;
        continue;
      }
      if ("_rpcError" in parsed && parsed.id === (promptReq.id as number)) {
        yield { type: "error", error: parsed._rpcError };
        return;
      }
      if ("_rpcResult" in parsed && parsed.id === (promptReq.id as number)) {
        yield { type: "done", finalText, harnessSessionId: sessionId };
        return;
      }
    }
    yield { type: "error", error: "ACP process ended without a prompt result" };
  }
}
