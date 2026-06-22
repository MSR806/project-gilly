import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Options, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  InvocationRequest,
  InvocationResult,
  SkillBundle,
  StreamEvent,
} from "@gilly/harness-protocol";

// Anchored to the repo root (this file lives at apps/harness-claude/src/) so dev works
// regardless of cwd; relative WORKSPACES_DIR anchors here, absolute values pass through.
const repoRoot = resolve(import.meta.dir, "../../..");

/** Scratch dir for one Gilly session's workspace. Pure: same request → same path. */
export function workspaceDir(req: InvocationRequest): string {
  const root = resolve(repoRoot, process.env.WORKSPACES_DIR ?? "data/workspaces");
  return join(root, req.workspace?.handle ?? "default");
}

/**
 * Assemble the SDK options shared by the streaming and non-streaming paths so they stay in
 * sync. Pure (no I/O). An "agentic" agent — one with built-in tools or skills — gets Claude
 * Code's tool-use guidance, bypassed permissions (headless: no human to approve), and a
 * sandboxed workspace. A bare chat agent stays chat-only.
 */
export function buildOptions(req: InvocationRequest, streaming: boolean): Options {
  const fsTools = req.agent.tools ?? [];
  const skills = req.skills ?? [];
  const hasSkills = skills.length > 0;
  const agentic = fsTools.length > 0 || hasSkills;
  // Skills load from <cwd>/.claude/skills via the "project" setting source; anything that
  // touches the filesystem also needs a place to act.
  const needsWorkspace = fsTools.length > 0 || hasSkills;

  // Tools the model may call: built-in tools plus the Skill tool (when skills are attached).
  const allowedTools = [...fsTools, ...(hasSkills ? ["Skill"] : [])];

  return {
    model: req.agent.model,
    allowedTools,
    // Agentic agents get the preset's tool-use guidance plus their role; chat-only agents get
    // the plain role prompt (the preset would pull in unwanted coding scaffolding).
    systemPrompt: agentic
      ? { type: "preset", preset: "claude_code", append: req.agent.systemPrompt }
      : req.agent.systemPrompt,
    // Skills are only loaded when a setting source is configured; "project" reads <cwd>/.claude.
    ...(hasSkills ? { settingSources: ["project"] as const } : {}),
    ...(agentic
      ? { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true }
      : {}),
    ...(needsWorkspace ? { cwd: workspaceDir(req) } : {}),
    ...(streaming ? { includePartialMessages: true } : {}),
    ...(req.resumeSessionId ? { resume: req.resumeSessionId } : {}),
  };
}

/**
 * Write each attached skill folder into `<cwd>/.claude/skills/<name>/` so the SDK's "project"
 * setting source discovers it. Side-effecting; called once per invocation before the loop runs.
 */
export function materializeSkills(skills: SkillBundle[], cwd: string): void {
  for (const skill of skills) {
    for (const file of skill.files) {
      const dest = join(cwd, ".claude", "skills", skill.name, file.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.contents);
    }
  }
}

/**
 * One-line summary of a tool call's input for progress display, e.g. the command for
 * Bash or the file path for Read/Edit. Pure; returns "" when there's nothing concise to show.
 */
export function summarizeToolUse(input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const pick =
    str(args.command) ||
    str(args.skill) || // Skill tool: the skill being invoked
    str(args.file_path) ||
    str(args.path) ||
    str(args.pattern) ||
    str(args.url) ||
    str(args.query) ||
    str(args.description); // Agent/Task tools: the task description
  const trimmed = pick.replace(/\s+/g, " ").trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

/** Collapse an SDK message stream to the session id and final text. Pure — no SDK calls. */
export async function reduceSdkStream(
  messages: AsyncIterable<SDKMessage>,
): Promise<{ harnessSessionId: string | null; finalText: string }> {
  let harnessSessionId: string | null = null;
  let resultText: string | null = null;
  let assistantText = "";

  for await (const message of messages) {
    if (message.type === "system" && message.subtype === "init") {
      harnessSessionId = message.session_id;
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") assistantText += block.text;
      }
    } else if (message.type === "result" && message.subtype === "success") {
      resultText = message.result;
    }
  }

  // Prefer the result message; fall back to accumulated assistant text.
  return { harnessSessionId, finalText: resultText ?? assistantText };
}

/**
 * Drives one Claude Agent SDK loop for an invocation. `queryFn` is injectable for tests.
 * Never throws: SDK/runtime failures come back as an `{ status: "error" }` result.
 */
export async function runAgentLoop(
  req: InvocationRequest,
  queryFn: typeof query = query,
): Promise<InvocationResult> {
  try {
    const options = buildOptions(req, false);
    if (options.cwd) {
      mkdirSync(options.cwd, { recursive: true });
      materializeSkills(req.skills ?? [], options.cwd);
    }
    const messages = queryFn({ prompt: req.userMessage, options });
    const { harnessSessionId, finalText } = await reduceSdkStream(messages);
    return { status: "completed", finalText, harnessSessionId, error: null };
  } catch (err) {
    return { status: "error", finalText: "", harnessSessionId: null, error: String(err) };
  }
}

/**
 * Streaming variant of {@link runAgentLoop}: yields incremental `token` events, then one
 * terminal `done` (or `error`). Never throws — failures surface as a final `error` event.
 */
export async function* streamAgentLoop(
  req: InvocationRequest,
  queryFn: typeof query = query,
): AsyncIterable<StreamEvent> {
  let harnessSessionId: string | null = null;
  let resultText: string | null = null;
  let accumulated = "";
  try {
    const options = buildOptions(req, true);
    if (options.cwd) {
      mkdirSync(options.cwd, { recursive: true });
      materializeSkills(req.skills ?? [], options.cwd);
    }
    const messages = queryFn({ prompt: req.userMessage, options });

    for await (const message of messages) {
      if (message.type === "system" && message.subtype === "init") {
        harnessSessionId = message.session_id;
      } else if (message.type === "stream_event") {
        const { event } = message;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          accumulated += event.delta.text;
          yield { type: "token", text: event.delta.text };
        }
      } else if (message.type === "assistant") {
        // A turn that calls tools also narrates first; surface that narration as a completed
        // intermediate `message`, then the tools. A text-only turn is the (final) answer and is
        // delivered via `done.finalText` — not surfaced here.
        let text = "";
        const tools: { name: string; input: unknown }[] = [];
        for (const block of message.message.content) {
          if (block.type === "text") text += block.text;
          else if (block.type === "tool_use") tools.push({ name: block.name, input: block.input });
        }
        if (tools.length) {
          const narration = text.trim();
          if (narration) yield { type: "message", text: narration };
          for (const t of tools) {
            yield { type: "tool", name: t.name, summary: summarizeToolUse(t.input) };
          }
        }
      } else if (message.type === "result" && message.subtype === "success") {
        resultText = message.result;
      }
    }
    yield { type: "done", finalText: resultText ?? accumulated, harnessSessionId };
  } catch (err) {
    yield { type: "error", error: String(err) };
  }
}
