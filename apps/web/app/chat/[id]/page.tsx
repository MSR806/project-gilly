"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
    <div className="chat">
      <div className="chat__head">
        <Link href="/" className="chat__back">
          ← Agents
        </Link>
        <span className="chat__agent">
          Agent: <code>{agentId}</code>
        </span>
      </div>

      <div ref={listRef} className="chat__messages">
        {messages.length === 0 ? (
          <p className="state">Send a message to start chatting.</p>
        ) : (
          messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const empty = m.parts.length === 0;
            return (
              <div key={i} className={`bubble bubble--${m.role}`}>
                {empty
                  ? streaming && isLast
                    ? "…"
                    : ""
                  : m.parts.map((part, j) =>
                      part.kind === "text" ? (
                        <span key={j}>{part.text}</span>
                      ) : (
                        <span key={j} className="bubble__tool">
                          🔧 <code>{part.name}</code>
                          {part.summary ? ` — ${part.summary}` : ""}
                        </span>
                      ),
                    )}
              </div>
            );
          })
        )}
      </div>

      {error ? <p className="state state--error">{error}</p> : null}

      <form
        className="chat__input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          value={input}
          disabled={streaming}
          placeholder="Type a message…"
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
