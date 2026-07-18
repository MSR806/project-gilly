export type HistoryStep =
  | { type: "message"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "error"; error: string };

export type HistoryRun = {
  id: string;
  status: "running" | "completed" | "error";
  input: string;
  output: string | null;
  error: string | null;
  createdAt: number;
  steps: HistoryStep[];
};

export type ConversationSummary = {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type Part =
  | { kind: "text"; text: string }
  | { kind: "activity"; items: Array<{ name: string; summary: string }> }
  | { kind: "error"; error: string };

export type Message = {
  role: "user" | "assistant";
  parts: Part[];
};

/** Append adjacent tools together without moving activity across intervening narration. */
export function appendActivityPart(parts: Part[], item: { name: string; summary: string }): Part[] {
  const last = parts.at(-1);
  if (last?.kind === "activity") {
    return [...parts.slice(0, -1), { kind: "activity", items: [...last.items, item] }];
  }
  return [...parts, { kind: "activity", items: [item] }];
}

/** Rebuild the durable transcript: progress narration/tools first, then the final answer. */
export function messagesFromRuns(runs: HistoryRun[]): Message[] {
  return runs.flatMap((run) => {
    const parts: Part[] = [];
    for (const step of run.steps) {
      if (step.type === "message") parts.push({ kind: "text", text: step.text });
      if (step.type === "tool") {
        const next = appendActivityPart(parts, { name: step.name, summary: step.summary });
        parts.splice(0, parts.length, ...next);
      }
    }
    if (run.output) parts.push({ kind: "text", text: run.output });
    if (run.error) parts.push({ kind: "error", error: run.error });
    return [
      { role: "user", parts: [{ kind: "text", text: run.input }] },
      { role: "assistant", parts },
    ];
  });
}
