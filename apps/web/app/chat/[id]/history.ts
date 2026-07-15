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
  | { kind: "tool"; name: string; summary: string }
  | { kind: "error"; error: string };

export type Message = {
  role: "user" | "assistant";
  parts: Part[];
};

/** Rebuild the durable transcript: progress narration/tools first, then the final answer. */
export function messagesFromRuns(runs: HistoryRun[]): Message[] {
  return runs.flatMap((run) => {
    const parts: Part[] = [];
    for (const step of run.steps) {
      if (step.type === "message") parts.push({ kind: "text", text: step.text });
      if (step.type === "tool") {
        parts.push({ kind: "tool", name: step.name, summary: step.summary });
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
