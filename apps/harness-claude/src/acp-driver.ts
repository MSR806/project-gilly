import { mkdirSync } from "node:fs";
import type { InvocationRequest, InvocationResult, StreamEvent } from "@gilly/harness-protocol";
import type { HarnessDriver } from "./driver.ts";
import { workspaceDir } from "./loop.ts";

/**
 * Translate an InvocationRequest's user message into ACP prompt content blocks.
 * Pure helper — exported for testing.
 */
export function buildPromptContent(req: InvocationRequest): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: req.userMessage }];
}

/**
 * Translate a single ACP SessionUpdate into a Gilly StreamEvent (or null if
 * the update type is not relevant to the Gilly wire format). Pure helper.
 */
export function translateUpdate(update: {
  sessionUpdate: string;
  content?: { type: string; text?: string };
  toolCallId?: string;
  title?: string;
  [key: string]: unknown;
}): StreamEvent | null {
  if (update.sessionUpdate === "agent_message_chunk") {
    if (update.content?.type === "text" && typeof update.content.text === "string") {
      return { type: "token", text: update.content.text };
    }
    return null;
  }
  if (update.sessionUpdate === "tool_call") {
    return {
      type: "tool",
      name: "tool_call",
      summary: update.title ?? "",
    };
  }
  // plan, plan_update, usage_update, etc. — not mapped to Gilly StreamEvent
  return null;
}

/** Shape of messages yielded by a session (matches what ActiveSession.nextUpdate produces). */
export interface SessionMessage {
  kind: string;
  update?: {
    sessionUpdate: string;
    content?: { type: string; text?: string };
    [k: string]: unknown;
  };
  response?: unknown;
  stopReason?: string;
}

/** Abstraction over session lifecycle so the real impl and tests share the same driver logic. */
export interface AcpSession {
  sessionId: string;
  messages(): AsyncIterable<SessionMessage>;
}

export type CreateSessionFn = (req: InvocationRequest) => Promise<AcpSession>;

export interface AcpDriverOptions {
  command: string;
  args?: string[];
  createSession?: CreateSessionFn;
}

/**
 * HarnessDriver that connects to an ACP-compatible agent process over stdio.
 *
 * In production, spawns `ACP_HARNESS_COMMAND` and speaks ACP JSON-RPC over
 * stdin/stdout. In tests, a `createSession` factory is injected to avoid real
 * process spawning.
 */
export class AcpHarnessDriver implements HarnessDriver {
  readonly name = "acp";
  private readonly command: string;
  private readonly args: string[];
  private readonly createSessionFn: CreateSessionFn;

  constructor(opts: AcpDriverOptions) {
    this.command = opts.command;
    this.args = opts.args ?? [];
    this.createSessionFn = opts.createSession ?? this.defaultCreateSession.bind(this);
  }

  async invoke(req: InvocationRequest): Promise<InvocationResult> {
    try {
      const session = await this.createSessionFn(req);
      let accumulated = "";
      for await (const msg of session.messages()) {
        if (msg.kind === "session_update" && msg.update) {
          const ev = translateUpdate(msg.update as Parameters<typeof translateUpdate>[0]);
          if (ev?.type === "token") accumulated += ev.text;
        }
        if (msg.kind === "stop") break;
      }
      return {
        status: "completed",
        finalText: accumulated,
        harnessSessionId: session.sessionId,
        error: null,
      };
    } catch (err) {
      return { status: "error", finalText: "", harnessSessionId: null, error: String(err) };
    }
  }

  async *invokeStream(req: InvocationRequest): AsyncIterable<StreamEvent> {
    try {
      const session = await this.createSessionFn(req);
      let accumulated = "";
      for await (const msg of session.messages()) {
        if (msg.kind === "session_update" && msg.update) {
          const ev = translateUpdate(msg.update as Parameters<typeof translateUpdate>[0]);
          if (ev) {
            if (ev.type === "token") accumulated += ev.text;
            yield ev;
          }
        }
        if (msg.kind === "stop") {
          yield { type: "done", finalText: accumulated, harnessSessionId: session.sessionId };
          return;
        }
      }
      // Stream ended without explicit stop — still emit done
      yield { type: "done", finalText: accumulated, harnessSessionId: session.sessionId };
    } catch (err) {
      yield { type: "error", error: String(err) };
    }
  }

  /**
   * Default session factory: spawns the ACP process and establishes a session.
   * Uses the @agentclientprotocol/sdk to create a ClientApp, connect over stdio,
   * and drive the session/prompt lifecycle.
   */
  private async defaultCreateSession(req: InvocationRequest): Promise<AcpSession> {
    // Dynamic import so the dependency is optional (only needed when driver=acp)
    const { client, ndJsonStream } = await import("@agentclientprotocol/sdk");

    const proc = Bun.spawn([this.command, ...this.args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });

    // Build web streams from Bun's process streams
    const toAgent = new WritableStream<Uint8Array>({
      write(chunk) {
        proc.stdin.write(chunk);
      },
      close() {
        proc.stdin.end();
      },
    });
    const fromAgent = proc.stdout as unknown as ReadableStream<Uint8Array>;

    const stream = ndJsonStream(toAgent, fromAgent);

    const app = client({ name: "gilly-harness" });
    const connection = app.connect(stream);
    const ctx = connection.agent;

    // ACP requires absolute cwd paths. Reuse the same workspace mapping as the
    // Claude SDK driver so all harness implementations see the same sandbox.
    const cwd = workspaceDir(req);
    mkdirSync(cwd, { recursive: true });

    const activeSession = await ctx.buildSession(cwd).start();
    const sessionId = activeSession.sessionId;

    // Send prompt — fire-and-forget; updates are consumed via nextUpdate()
    const promptContent = buildPromptContent(req);
    activeSession.prompt(promptContent);

    return {
      sessionId,
      async *messages(): AsyncIterable<SessionMessage> {
        while (true) {
          const msg = await activeSession.nextUpdate();
          if (msg.kind === "stop") {
            yield { kind: "stop", response: msg.response, stopReason: msg.stopReason };
            return;
          }
          if (msg.kind === "session_update") {
            yield {
              kind: "session_update",
              update: msg.update as SessionMessage["update"],
            };
          }
        }
      },
    };
  }
}
