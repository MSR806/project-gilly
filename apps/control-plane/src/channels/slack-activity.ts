import type { StreamEvent } from "@gilly/runtime";

const MAX_ACTIVITY_LENGTH = 72;
const COMMAND_TOOLS = new Set([
  "bash",
  "command",
  "exec",
  "exec_command",
  "run_command",
  "shell",
  "terminal",
]);
const FILE_TOOLS = new Set(["edit", "read", "write"]);
const SEARCH_COMMANDS = new Set(["grep", "rg"]);
const SCRIPT_RUNNERS = new Set(["bun", "deno", "node", "python", "python3", "ruby", "tsx"]);
const SAFE_DETAIL_TOOLS = new Set(["skill", "gateway_catalog", "gateway_invoke"]);

/** `mcp__gateway__gateway_invoke` → `gateway_invoke`; non-MCP names pass through. */
const stripMcpPrefix = (name: string): string => name.replace(/^mcp__.+?__/, "");

type OperationEvent = Extract<StreamEvent, { type: "message" | "tool" }>;

export type SlackActivity = {
  count: number;
  details?: string;
  groupKey: string;
  title: string;
  unit: "edits" | "reads" | "runs" | "steps" | "writes";
};

const truncate = (text: string, maximum = MAX_ACTIVITY_LENGTH): string =>
  text.length > maximum ? `${text.slice(0, maximum - 1).trimEnd()}…` : text;

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

const basename = (path: string): string => {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
};

function compactFilePath(summary: string): string {
  const path = normalize(summary)
    .replace(/^['"]|['"]$/g, "")
    .replaceAll("\\", "/");
  return truncate(basename(path) || "file");
}

/** Minimal shell tokenization used only for deriving a display label. */
function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let escaped = false;
  let quote: "'" | '"' | null = null;

  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

const isAssignment = (token: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
const isOperator = (token: string): boolean => ["&&", "||", ";", "|"].includes(token);

function positionalsBeforeFlags(tokens: readonly string[]): string[] {
  const positionals: string[] = [];
  for (const token of tokens) {
    if (token === "--") continue;
    if (token.startsWith("-") || isOperator(token)) break;
    positionals.push(token);
  }
  return positionals;
}

function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function commandActivity(summary: string): SlackActivity {
  const tokens = shellTokens(summary);
  while (tokens[0] && isAssignment(tokens[0])) tokens.shift();
  const executableToken = tokens.shift();
  if (!executableToken) {
    return { count: 1, groupKey: "bash:empty", title: "Bash", unit: "runs" };
  }

  const executable = basename(executableToken).toLowerCase();
  if (SEARCH_COMMANDS.has(executable)) {
    return {
      count: 1,
      details: executable,
      groupKey: `search:${executable}:${fingerprint(normalize(summary))}`,
      title: "Search",
      unit: "runs",
    };
  }

  const positionals = positionalsBeforeFlags(tokens);
  if (SCRIPT_RUNNERS.has(executable)) {
    const target = positionals[0];
    if (!target) {
      return {
        count: 1,
        details: truncate(executable),
        groupKey: `command:${executable}`,
        title: "Bash",
        unit: "runs",
      };
    }

    if (target === "run") {
      return {
        count: 1,
        details: `${executable} run`,
        groupKey: `command:${executable}:run`,
        title: "Bash",
        unit: "runs",
      };
    }

    const script = basename(target);
    return {
      count: 1,
      details: compactFilePath(script),
      groupKey: `command:${script.toLowerCase()}`,
      title: "Bash",
      unit: "runs",
    };
  }

  return {
    count: 1,
    details: truncate(executable),
    groupKey: `command:${executable}`,
    title: "Bash",
    unit: "runs",
  };
}

/** Convert one canonical operation into Slack-only display metadata without mutating the event. */
export function toSlackActivity(event: OperationEvent): SlackActivity {
  if (event.type === "message") {
    const firstLine = event.text.trim().split("\n", 1)[0]?.trim() || "Thinking…";
    const title = truncate(firstLine);
    return {
      count: 1,
      groupKey: `message:${fingerprint(title)}`,
      title,
      unit: "steps",
    };
  }

  const tool = stripMcpPrefix(normalize(event.name)) || "Tool";
  const normalizedTool = tool.toLowerCase();
  if (COMMAND_TOOLS.has(normalizedTool)) return commandActivity(event.summary);

  if (FILE_TOOLS.has(normalizedTool)) {
    const unit =
      normalizedTool === "read" ? "reads" : normalizedTool === "edit" ? "edits" : "writes";
    return {
      count: 1,
      details: compactFilePath(event.summary),
      groupKey: `file:${normalizedTool}`,
      title: truncate(tool, 32),
      unit,
    };
  }

  const details = SAFE_DETAIL_TOOLS.has(normalizedTool)
    ? truncate(normalize(event.summary))
    : undefined;
  return {
    count: 1,
    ...(details ? { details } : {}),
    groupKey: `tool:${normalizedTool}:${details ? fingerprint(details) : ""}`,
    title: truncate(tool, 32),
    unit: "runs",
  };
}

/** Add an activity, combining only adjacent equivalent operations and retaining three groups. */
export function appendSlackActivity(
  groups: readonly SlackActivity[],
  activity: SlackActivity,
): readonly SlackActivity[] {
  const previous = groups.at(-1);
  if (!previous || previous.groupKey !== activity.groupKey) {
    return [...groups, activity].slice(-3);
  }

  const merged: SlackActivity = {
    ...previous,
    count: previous.count + activity.count,
    ...(activity.details ? { details: activity.details } : {}),
  };
  return [...groups.slice(0, -1), merged];
}

export function renderSlackActivity(activity: SlackActivity): string {
  const detail = activity.details ? ` — ${activity.details}` : "";
  const count = activity.count > 1 ? ` · ${activity.count} ${activity.unit}` : "";
  return `• *${activity.title}*${detail}${count}`;
}
