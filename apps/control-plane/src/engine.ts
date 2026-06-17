import type { AgentConfig } from "@gilly/core";
import {
  completeRun,
  createRun,
  type Db,
  dequeueFollowUp,
  enqueueFollowUp,
  failRun,
  getOrCreateSession,
  hasActiveRun,
  setHarnessSession,
} from "@gilly/db";
import type { RuntimeProvider, StreamEvent } from "@gilly/runtime";

export type EngineInput = {
  agentId: string;
  source: string;
  sourceKey: string;
  userMessage: string;
  reply: (text: string) => Promise<void>;
};

/** Streaming input: same as EngineInput but the caller consumes events instead of `reply`. */
export type StreamInput = Omit<EngineInput, "reply">;

/** Orchestrates the session/run lifecycle. Runtime- and transport-agnostic. */
export function createEngine(deps: {
  db: Db;
  runtime: RuntimeProvider;
  agents: Map<string, AgentConfig>;
}) {
  const { db, runtime, agents } = deps;

  async function handle(input: EngineInput): Promise<void> {
    const agent = agents.get(input.agentId);
    if (!agent) {
      await input.reply(`Unknown agent: ${input.agentId}`);
      return;
    }

    const session = getOrCreateSession(db, {
      agentId: input.agentId,
      source: input.source,
      sourceKey: input.sourceKey,
    });

    // One active run per session: queue follow-ups silently.
    if (hasActiveRun(db, session.id)) {
      enqueueFollowUp(db, session.id, input.userMessage);
      return;
    }

    let message = input.userMessage;
    let resumeId = session.harnessSessionId;

    for (;;) {
      const run = createRun(db, session.id, message);
      try {
        const result = await runtime.invoke({
          agent,
          userMessage: message,
          resumeSessionId: resumeId ?? undefined,
        });
        if (result.harnessSessionId) {
          setHarnessSession(db, session.id, result.harnessSessionId);
          resumeId = result.harnessSessionId;
        }
        if (result.status === "completed") {
          completeRun(db, run.id, result.finalText);
          await input.reply(result.finalText);
        } else {
          failRun(db, run.id, result.error ?? "unknown error");
          await input.reply(`⚠️ ${result.error ?? "run failed"}`);
        }
      } catch (e) {
        failRun(db, run.id, String(e));
        await input.reply(`⚠️ ${String(e)}`);
      }

      const next = dequeueFollowUp(db, session.id);
      if (!next) break;
      message = next.input;
    }
  }

  /**
   * Streaming variant for request-scoped channels (web chat): yields tokens as they
   * arrive while still recording the Session/Run. No follow-up queue — each call is
   * one request; concurrency is the caller's to serialize.
   */
  async function* stream(input: StreamInput): AsyncIterable<StreamEvent> {
    const agent = agents.get(input.agentId);
    if (!agent) {
      yield { type: "error", error: `Unknown agent: ${input.agentId}` };
      return;
    }

    const session = getOrCreateSession(db, {
      agentId: input.agentId,
      source: input.source,
      sourceKey: input.sourceKey,
    });
    const run = createRun(db, session.id, input.userMessage);

    let accumulated = "";
    try {
      const events = runtime.invokeStream({
        agent,
        userMessage: input.userMessage,
        resumeSessionId: session.harnessSessionId ?? undefined,
      });
      for await (const event of events) {
        if (event.type === "token") {
          accumulated += event.text;
        } else if (event.type === "done") {
          if (event.harnessSessionId) setHarnessSession(db, session.id, event.harnessSessionId);
          completeRun(db, run.id, event.finalText || accumulated);
        } else {
          failRun(db, run.id, event.error);
        }
        yield event;
      }
    } catch (e) {
      failRun(db, run.id, String(e));
      yield { type: "error", error: String(e) };
    }
  }

  return { handle, stream };
}
