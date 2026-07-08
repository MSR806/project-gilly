"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseSseStream } from "./sse";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

/** Ordered pieces of one message: text segments and tool calls, in arrival order. */
type Part = { kind: "text"; text: string } | { kind: "tool"; name: string; summary: string };

type Message = {
  role: "user" | "assistant";
  parts: Part[];
};

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const message = input.trim();
    if (!message || streaming) return;

    setInput("");
    setError(null);
    setStreaming(true);
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
      setError(err instanceof Error ? err.message : "Chat request failed");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-[calc(100svh-3.5rem-3rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <Link href="/agents" className="hover:text-foreground">
          ← Agents
        </Link>
        <span>
          Agent: <code className="font-mono text-xs">{agentId}</code>
        </span>
      </div>

      <div ref={listRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-1">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Send a message to start chatting.</p>
        ) : (
          messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const empty = m.parts.length === 0;
            return (
              <div
                key={i}
                className={`max-w-[75%] whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-sm ${
                  m.role === "user"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start border bg-card"
                }`}
              >
                {empty
                  ? streaming && isLast
                    ? "…"
                    : ""
                  : m.parts.map((part, j) =>
                      part.kind === "text" ? (
                        <span key={j}>{part.text}</span>
                      ) : (
                        <span
                          key={j}
                          className="my-1.5 block border-l-2 border-primary py-0.5 pl-2 text-xs opacity-85"
                        >
                          🔧 <code className="font-mono">{part.name}</code>
                          {part.summary ? ` — ${part.summary}` : ""}
                        </span>
                      ),
                    )}
              </div>
            );
          })
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          type="text"
          value={input}
          disabled={streaming}
          placeholder="Type a message…"
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
