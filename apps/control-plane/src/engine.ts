import type { AgentConfig } from "@gilly/core";
import {
  completeRun,
  createRun,
  type Db,
  dequeueAllFollowUps,
  enqueueFollowUp,
  failRun,
  getOrCreateSession,
  getSessionById,
  hasActiveRun,
  setHarnessSession,
} from "@gilly/db";
import type { SkillBundle } from "@gilly/harness-protocol";
import type { RuntimeProvider, StreamEvent } from "@gilly/runtime";

/** One run handed to a conversational channel: the messages it answers, the raw prompt, the stream. */
export type RunContext = {
  refs: string[];
  /** Raw prompt for this run (for display/titles) — without any prepended context. */
  message: string;
  /** The run's event stream. The channel MUST consume it (that's what records the Run). */
  events: AsyncIterable<StreamEvent>;
};

/** The minimal addressed message a channel hands the engine. */
export type MessageInput = {
  agentId: string;
  source: string;
  sourceKey: string;
  userMessage: string;
};

export type StreamInput = MessageInput;

export type HandleInput = MessageInput & {
  /** Extra context prepended to the *primary* run only (e.g. a Slack thread transcript). */
  context?: string;
  /** Opaque id for this message (e.g. Slack ts), surfaced back in `RunContext.refs`. */
  ref?: string;
  /** Drives one run: primary message, then each drained batch. */
  run: (ctx: RunContext) => Promise<void>;
};

const compose = (raw: string, context?: string) =>
  context ? `Thread so far:\n${context}\n\n---\nRequest: ${raw}` : raw;

async function* oneError(error: string): AsyncGenerator<StreamEvent> {
  yield { type: "error", error };
}

/** Orchestrates the session/run lifecycle. Runtime- and transport-agnostic. */
export function createEngine(deps: {
  db: Db;
  runtime: RuntimeProvider;
  agents: Map<string, AgentConfig>;
  /** Skill bundles by name, for resolving an agent's attached skills; defaults to none. */
  skills?: Map<string, SkillBundle>;
}) {
  const { db, runtime, agents } = deps;
  const skills = deps.skills ?? new Map<string, SkillBundle>();

  /** Gather the skill bundles an agent attaches. Throws on an unknown name (caught by runFrom). */
  function skillsFor(agent: AgentConfig): SkillBundle[] {
    return (agent.skills ?? []).map((name) => {
      const bundle = skills.get(name);
      if (!bundle) throw new Error(`Agent "${agent.id}" references unknown skill "${name}"`);
      return bundle;
    });
  }

  /** Stream one already-created run: invoke the harness, persist results, re-yield events. */
  async function* runFrom(
    runId: string,
    sessionId: string,
    agent: AgentConfig,
    message: string,
  ): AsyncGenerator<StreamEvent> {
    let accumulated = "";
    try {
      // Resolve instructions (skills) before invoking. May throw on a misconfigured agent
      // (unknown skill name) — caught below and recorded as a failed run.
      const skillBundles = skillsFor(agent);
      const events = runtime.invokeStream({
        agent,
        userMessage: message,
        resumeSessionId: getSessionById(db, sessionId)?.harnessSessionId ?? undefined,
        // Stable per-Gilly-session workspace, so follow-ups see files earlier runs made.
        workspace: { provider: "local", handle: sessionId },
        ...(skillBundles.length ? { skills: skillBundles } : {}),
      });
      for await (const event of events) {
        if (event.type === "token") {
          accumulated += event.text;
        } else if (event.type === "done") {
          if (event.harnessSessionId) setHarnessSession(db, sessionId, event.harnessSessionId);
          completeRun(db, runId, event.finalText || accumulated);
        } else if (event.type === "error") {
          failRun(db, runId, event.error);
        }
        // `tool` events are progress only — passed through to the channel, not persisted.
        yield event;
      }
    } catch (e) {
      failRun(db, runId, String(e));
      yield { type: "error", error: String(e) };
    }
  }

  /** One run, request-scoped (web chat). No queue — concurrency is the caller's to serialize. */
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
    yield* runFrom(run.id, session.id, agent, input.userMessage);
  }

  /**
   * Conversational channels (Slack): one active Run per Session. Messages arriving during a
   * run are queued and answered together as one batch. Each run is handed to `input.run` as a
   * stream the channel renders; the Run is created eagerly so the active-run guard is reliable.
   */
  async function handle(input: HandleInput): Promise<{ queued: boolean }> {
    const agent = agents.get(input.agentId);
    if (!agent) {
      await input.run({
        refs: input.ref ? [input.ref] : [],
        message: input.userMessage,
        events: oneError(`Unknown agent: ${input.agentId}`),
      });
      return { queued: false };
    }

    const session = getOrCreateSession(db, {
      agentId: input.agentId,
      source: input.source,
      sourceKey: input.sourceKey,
    });
    if (hasActiveRun(db, session.id)) {
      enqueueFollowUp(db, session.id, input.userMessage, input.ref);
      return { queued: true };
    }

    let raw = input.userMessage;
    let composed = compose(raw, input.context);
    let refs = input.ref ? [input.ref] : [];

    for (;;) {
      const run = createRun(db, session.id, composed); // eager → guard is reliable
      try {
        await input.run({
          refs,
          message: raw,
          events: runFrom(run.id, session.id, agent, composed),
        });
      } catch (e) {
        failRun(db, run.id, String(e)); // channel threw before finalizing — don't leave it active
        throw e;
      }

      // Everything queued while we ran gets answered together; no thread context re-fetch.
      const batch = dequeueAllFollowUps(db, session.id);
      if (!batch.length) break;
      raw = batch.map((b) => b.input).join("\n\n");
      composed = raw;
      refs = batch.map((b) => b.ref).filter((r): r is string => r !== null);
    }
    return { queued: false };
  }

  return { handle, stream };
}
