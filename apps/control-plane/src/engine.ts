import type { AgentConfig } from "@gilly/core";
import {
  appendRunStep,
  completeRun,
  createGatewayToken,
  createRun,
  type Db,
  deleteGatewayTokensForRun,
  dequeueAllFollowUps,
  enqueueFollowUp,
  failRun,
  getOrCreateSession,
  getSessionById,
  getUser,
  hasActiveRun,
  listGrants,
  setHarnessSession,
} from "@gilly/db";
import type { SkillBundle } from "@gilly/harness-protocol";
import type { RuntimeProvider, StreamEvent } from "@gilly/runtime";

const RUN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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
  /** Resolved internal user id (from the channel's identity upsert); mints a gateway token. */
  userId?: string;
};

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
  /** Resolve an agent by id at call time — DB-backed in prod, so runtime-created agents are seen. */
  getAgent: (id: string) => AgentConfig | undefined;
  /** Resolve a skill bundle by name (the SkillStore seam); defaults to "no skills". */
  getSkill?: (name: string) => SkillBundle | undefined;
  /** Tooling gateway base URL; when set, runs with matching grants get a per-run gateway token. */
  gatewayUrl?: string;
  /** Max silence between runtime stream events before the run is failed. */
  runIdleTimeoutMs?: number;
}) {
  const { db, runtime, getAgent, gatewayUrl } = deps;
  const getSkill = deps.getSkill ?? (() => undefined);
  const runIdleTimeoutMs = deps.runIdleTimeoutMs ?? RUN_IDLE_TIMEOUT_MS;

  function withRunTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Run timed out waiting for the agent runtime.")),
          runIdleTimeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }

  /** Best-effort cleanup of a run's gateway tokens; never breaks the run. */
  function cleanupGatewayTokens(runId: string) {
    try {
      deleteGatewayTokensForRun(db, runId);
    } catch (e) {
      console.warn(`[engine] gateway token cleanup failed for run ${runId}:`, String(e));
    }
  }

  /** Gather the skill bundles an agent attaches. Throws on an unknown name (caught by runFrom). */
  function skillsFor(agent: AgentConfig): SkillBundle[] {
    return (agent.skills ?? []).map((name) => {
      const bundle = getSkill(name);
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
    userId?: string,
  ): AsyncGenerator<StreamEvent> {
    let accumulated = "";
    let terminal = false;
    let iterator: AsyncIterator<StreamEvent> | undefined;
    try {
      // Resolve instructions (skills) before invoking. May throw on a misconfigured agent
      // (unknown skill name) — caught below and recorded as a failed run.
      const skillBundles = skillsFor(agent);

      // Effective grants. Admins bypass per-connector grants — they get every tool the agent is
      // configured to use (its connectors are still the ceiling). Everyone else: their grant
      // patterns whose connector prefix is in the agent's connectors.
      const conns = new Set(agent.connectors ?? []);
      const user = userId ? getUser(db, userId) : undefined;
      const grants = !user
        ? []
        : user.isAdmin
          ? [...conns].map((c) => `${c}.*`)
          : listGrants(db, user.id)
              .map((g) => g.toolPattern)
              .filter((p) => conns.has(p.split(".")[0] ?? ""));
      let gateway: { url: string; token: string } | undefined;
      if (gatewayUrl && userId && grants.length > 0) {
        const token = createGatewayToken(db, {
          runId,
          userId,
          agentId: agent.id,
          grants,
          ttlMs: 60 * 60 * 1000,
        });
        gateway = { url: gatewayUrl, token };
      }
      console.log(
        `[engine] run start run=${runId} agent=${agent.id} session=${sessionId} gateway=${grants.join(",") || "-"} input=${JSON.stringify(message.slice(0, 80))}`,
      );

      iterator = runtime
        .invokeStream({
          agent,
          userMessage: message,
          resumeSessionId: getSessionById(db, sessionId)?.harnessSessionId ?? undefined,
          // Stable per-Gilly-session workspace, so follow-ups see files earlier runs made.
          workspace: { provider: "local", handle: sessionId },
          ...(skillBundles.length ? { skills: skillBundles } : {}),
          ...(gateway ? { gateway } : {}),
        })
        [Symbol.asyncIterator]();

      for (;;) {
        const next = await withRunTimeout(iterator.next());
        if (next.done) break;
        const event = next.value;
        let stop = false;
        if (event.type === "token") {
          accumulated += event.text;
        } else if (event.type === "done") {
          if (event.harnessSessionId) setHarnessSession(db, sessionId, event.harnessSessionId);
          completeRun(db, runId, event.finalText || accumulated);
          console.log(
            `[engine] run done run=${runId} agent=${agent.id} outputChars=${(event.finalText || accumulated).length}`,
          );
          terminal = true;
          stop = true;
        } else if (event.type === "error") {
          appendRunStep(db, runId, event);
          failRun(db, runId, event.error);
          console.warn(`[engine] run error run=${runId} agent=${agent.id} error=${event.error}`);
          terminal = true;
          stop = true;
        } else if (event.type === "tool") {
          appendRunStep(db, runId, event);
          console.log(
            `[engine] run tool run=${runId} agent=${agent.id} tool=${event.name} summary=${JSON.stringify(event.summary)}`,
          );
        } else if (event.type === "message") {
          appendRunStep(db, runId, event);
          console.log(
            `[engine] run message run=${runId} agent=${agent.id} chars=${event.text.length}`,
          );
        }
        // Progress events are persisted above, then passed through unchanged for channel rendering.
        yield event;
        if (stop) break;
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (!terminal) {
        appendRunStep(db, runId, { type: "error", error });
        failRun(db, runId, error);
        terminal = true;
      }
      console.warn(`[engine] run error run=${runId} agent=${agent.id} error=${error}`);
      yield { type: "error", error };
    } finally {
      try {
        void iterator?.return?.();
      } catch {
        // Best-effort runtime cancellation; the run row cleanup below is authoritative.
      }
      if (!terminal) {
        const error = "Run interrupted before terminal event.";
        appendRunStep(db, runId, { type: "error", error });
        failRun(db, runId, error);
        console.warn(`[engine] run interrupted run=${runId} agent=${agent.id} error=${error}`);
      }
      cleanupGatewayTokens(runId);
    }
  }

  /** One run, request-scoped (web chat). No queue — concurrency is the caller's to serialize. */
  async function* stream(input: MessageInput): AsyncIterable<StreamEvent> {
    const agent = getAgent(input.agentId);
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
    yield* runFrom(run.id, session.id, agent, input.userMessage, input.userId);
  }

  /** Start one request-scoped run in the background and return its durable id immediately. */
  function start(input: MessageInput): { runId: string } {
    const agent = getAgent(input.agentId);
    if (!agent) throw new Error(`Unknown agent: ${input.agentId}`);
    const session = getOrCreateSession(db, {
      agentId: input.agentId,
      source: input.source,
      sourceKey: input.sourceKey,
    });
    const run = createRun(db, session.id, input.userMessage);
    void (async () => {
      for await (const _ of runFrom(run.id, session.id, agent, input.userMessage, input.userId)) {
        // Background runs persist events in runFrom; there is no channel consumer to render them.
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      appendRunStep(db, run.id, { type: "error", error: message });
      failRun(db, run.id, message);
      cleanupGatewayTokens(run.id);
      console.warn(
        `[engine] background run failed run=${run.id} agent=${agent.id}:`,
        String(error),
      );
    });
    return { runId: run.id };
  }

  /**
   * Conversational channels (Slack): one active Run per Session. Messages arriving during a
   * run are queued and answered together as one batch. Each run is handed to `input.run` as a
   * stream the channel renders; the Run is created eagerly so the active-run guard is reliable.
   */
  async function handle(input: HandleInput): Promise<{ queued: boolean }> {
    const agent = getAgent(input.agentId);
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
          events: runFrom(run.id, session.id, agent, composed, input.userId),
        });
      } catch (e) {
        failRun(db, run.id, String(e)); // channel threw before finalizing — don't leave it active
        cleanupGatewayTokens(run.id);
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

  return { handle, start, stream };
}
