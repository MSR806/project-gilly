"use client";

import { ChevronLeft, LoaderCircle, SendHorizontal, Wrench } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type Activity, activityFor, parseSseStream } from "./sse";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

/** Ordered pieces of one message: text segments and tool calls, in arrival order. */
type Part = { kind: "text"; text: string } | { kind: "tool"; name: string; summary: string };

type Message = {
  role: "user" | "assistant";
  parts: Part[];
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_ul]:list-disc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children: tableChildren }) => (
            <div className="my-4 overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-left text-sm">{tableChildren}</table>
            </div>
          ),
          th: ({ children: cellChildren }) => (
            <th className="border-b bg-muted px-3 py-2 font-medium">{cellChildren}</th>
          ),
          td: ({ children: cellChildren }) => (
            <td className="border-b px-3 py-2 last:border-b-0">{cellChildren}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<Activity>(null);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const input = inputRef.current;
    const message = input?.value.trim() ?? "";
    if (!input || !message || streaming) return;

    input.value = "";
    setError(null);
    setStreaming(true);
    setActivity(activityFor("send"));
    const request = new AbortController();
    requestRef.current = request;
    setMessages((prev) => [
      ...prev,
      { role: "user", parts: [{ kind: "text", text: message }] },
      { role: "assistant", parts: [] },
    ]);

    // Update the in-flight assistant message (always the last one) by transforming its parts.
    const updateAssistant = (fn: (parts: Part[]) => Part[]) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, parts: fn(last.parts) };
        return next;
      });
    };

    // Append a text delta to the trailing text part, or start a new one (after a tool call).
    const appendText = (delta: string) =>
      updateAssistant((parts) => {
        const last = parts[parts.length - 1];
        if (last?.kind === "text") {
          return [...parts.slice(0, -1), { kind: "text", text: last.text + delta }];
        }
        return [...parts, { kind: "text", text: delta }];
      });

    const appendTool = (name: string, summary: string) =>
      updateAssistant((parts) => [...parts, { kind: "tool", name, summary }]);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          agentId,
          message,
          conversationId: conversationId.current,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }

      const cid = res.headers.get("x-conversation-id");
      if (cid) conversationId.current = cid;

      for await (const event of parseSseStream(res.body)) {
        setActivity(activityFor(event.type));
        if (event.type === "token") {
          appendText(event.text);
        } else if (event.type === "tool") {
          appendTool(event.name, event.summary);
        } else if (event.type === "done") {
          // Fallback only: if nothing streamed (non-streaming path), show the final text.
          if (event.finalText) {
            updateAssistant((parts) =>
              parts.length ? parts : [{ kind: "text", text: event.finalText }],
            );
          }
        } else if (event.type === "error") {
          setError(event.error);
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Chat request failed");
      }
    } finally {
      requestRef.current = null;
      setActivity(null);
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-[calc(100svh-3.5rem-3rem)] min-h-[32rem] flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between pb-4 text-sm text-muted-foreground">
        <Link
          href="/agents"
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Agents
        </Link>
        <span className="truncate rounded-full bg-muted px-3 py-1.5">
          Agent <code className="font-mono text-xs text-foreground">{agentId}</code>
        </span>
      </div>

      <div ref={listRef} className="flex flex-1 flex-col gap-8 overflow-y-auto px-1 py-4">
        {messages.length === 0 ? (
          <div className="m-auto max-w-sm text-center">
            <h1 className="text-xl font-medium">What can I help you investigate?</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Ask a question and follow the response and tool activity here.
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            return (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "max-w-[75%] self-end whitespace-pre-wrap break-words rounded-2xl bg-muted px-5 py-3.5 text-[15px] leading-7 text-foreground"
                    : "w-full space-y-4 text-[15px] leading-7 text-foreground"
                }
              >
                {m.parts.map((part, j) =>
                  part.kind === "text" ? (
                    m.role === "assistant" ? (
                      <Markdown key={j}>{part.text}</Markdown>
                    ) : (
                      <p key={j}>{part.text}</p>
                    )
                  ) : (
                    <div
                      key={j}
                      className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"
                    >
                      <Wrench className="mt-0.5 size-3.5 shrink-0 text-foreground" />
                      <span>
                        <code className="font-mono text-[11px] text-foreground">{part.name}</code>
                        {part.summary ? ` — ${part.summary}` : ""}
                      </span>
                    </div>
                  ),
                )}
                {streaming && isLast ? (
                  <span className="flex items-center justify-end gap-2 pt-1 text-xs text-muted-foreground">
                    <LoaderCircle className="size-3.5 animate-spin text-primary" />
                    {activity ?? "Awaiting response…"}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <form
        className="shrink-0 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
        <div className="rounded-[18px] border border-input bg-card p-3 shadow-sm transition-colors focus-within:border-ring">
          <Textarea
            ref={inputRef}
            disabled={streaming}
            aria-label="Chat message"
            placeholder="Ask me anything…"
            className="max-h-40 min-h-16 resize-none border-0 bg-transparent px-2 py-1 text-base leading-6 shadow-none focus-visible:border-0 focus-visible:ring-0 disabled:bg-transparent"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-2 flex justify-end">
            {streaming ? (
              <Button
                type="button"
                className="h-9 gap-2 px-4"
                onClick={() => requestRef.current?.abort()}
              >
                <LoaderCircle className="animate-spin" />
                Cancel
              </Button>
            ) : (
              <Button type="submit" className="h-9 gap-2 px-4">
                <SendHorizontal />
                Send
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          AI can make mistakes. Please double-check important responses.
        </p>
      </form>
    </div>
  );
}
