export type ActivityItem = {
  name: string;
  summary: string;
};

export type ActivityGroup = {
  label: string;
  detail: string;
  count: number;
};

const FILE_TOOLS = new Set(["edit", "read", "write"]);
const COMMAND_TOOLS = new Set([
  "bash",
  "command",
  "exec",
  "exec_command",
  "run_command",
  "shell",
  "terminal",
]);
const COMMAND_RUNNERS = new Set(["bun", "deno", "node", "python", "python3", "ruby"]);
const SAFE_DETAIL_TOOLS = new Set(["skill"]);

function basename(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? value;
}

function trimQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function shortenPath(value: string): string {
  const normalized = trimQuotes(value.trim()).replaceAll("\\", "/");
  const workspaceMarker = "/data/workspaces/";
  const markerIndex = normalized.indexOf(workspaceMarker);
  if (markerIndex !== -1) {
    const afterMarker = normalized.slice(markerIndex + workspaceMarker.length);
    return afterMarker.split("/").slice(1).join("/") || basename(normalized);
  }

  if (normalized.startsWith("/")) {
    return normalized.split("/").filter(Boolean).slice(-3).join("/");
  }
  return normalized;
}

function shorten(value: string, limit = 80): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function shellWords(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|&&|\|\||[|;]|[^\s]+/g) ?? []).map(trimQuotes);
}

function commandSegment(words: string[]): string[] {
  const segments: string[][] = [[]];
  for (const word of words) {
    if (["&&", "||", "|", ";"].includes(word)) {
      segments.push([]);
    } else {
      segments.at(-1)?.push(word);
    }
  }
  return (
    segments.findLast((segment) => segment.length > 0 && basename(segment[0] ?? "") !== "cd") ?? []
  );
}

const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

/** Derive a conservative command label without exposing arguments or flag values. */
export function compactCommand(command: string): string {
  const words = commandSegment(shellWords(command));
  while (words[0] && isAssignment(words[0])) words.shift();
  const executable = basename(words[0] ?? "");
  if (!executable) return "command";

  if (COMMAND_RUNNERS.has(executable)) {
    const script = words[1];
    if (!script) return executable;
    if (script === "-m") return `${executable} -m`;
    if (script.startsWith("-")) return executable;
    if (script === "run") return `${executable} run`;
    const isScript = script.includes("/") || /\.[a-z0-9]+$/i.test(script);
    if (!isScript) return executable;
    return basename(script);
  }

  if (["grep", "rg"].includes(executable)) return executable;
  return executable;
}

function compactItem(item: ActivityItem): ActivityGroup & { groupKey: string; target: string } {
  const label = item.name.trim() || "Tool";
  const normalizedName = label.toLowerCase();
  if (COMMAND_TOOLS.has(normalizedName)) {
    const detail = compactCommand(item.summary);
    return { label, detail, count: 1, groupKey: `bash:${detail}`, target: detail };
  }

  if (FILE_TOOLS.has(normalizedName)) {
    const target = shorten(shortenPath(item.summary));
    return { label, detail: target, count: 1, groupKey: normalizedName, target };
  }

  const detail = SAFE_DETAIL_TOOLS.has(normalizedName) ? shorten(shortenPath(item.summary)) : "";
  return {
    label,
    detail,
    count: 1,
    groupKey: `${normalizedName}:${detail}`,
    target: detail,
  };
}

/** Group consecutive web activity without changing the source events. */
export function groupActivity(items: readonly ActivityItem[]): ActivityGroup[] {
  const groups: Array<ActivityGroup & { groupKey: string; targets: string[] }> = [];

  for (const item of items) {
    const compact = compactItem(item);
    const previous = groups.at(-1);
    if (previous?.groupKey === compact.groupKey) {
      previous.count += 1;
      if (!previous.targets.includes(compact.target)) previous.targets.push(compact.target);
      continue;
    }
    groups.push({
      label: compact.label,
      detail: compact.detail,
      count: 1,
      groupKey: compact.groupKey,
      targets: [compact.target],
    });
  }

  return groups.map(({ label, detail, count, targets, groupKey }) => {
    if (FILE_TOOLS.has(groupKey) && count > 1) {
      const names = targets.slice(0, 2).map(basename).join(", ");
      const remainder = targets.length > 2 ? ` +${targets.length - 2}` : "";
      const unit = groupKey === "read" ? "reads" : groupKey === "edit" ? "edits" : "writes";
      return { label, detail: `${count} ${unit}${names ? ` · ${names}${remainder}` : ""}`, count };
    }
    if (count <= 1) return { label, detail, count };
    return { label, detail: detail ? `${detail} · ${count} runs` : `${count} runs`, count };
  });
}
