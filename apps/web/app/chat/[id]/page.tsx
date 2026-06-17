"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseSseStream } from "./sse";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Message = {
  role: "user" | "assistant";
  text: string;
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
      { role: "user", text: message },
      { role: "assistant", text: "" },
    ]);

    const appendToAssistant = (delta: string) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, text: last.text + delta };
        return next;
      });
    };

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
          appendToAssistant(event.text);
        } else if (event.type === "done") {
          if (event.finalText) {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", text: event.finalText };
              return next;
            });
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
          messages.map((m, i) => (
            <div key={i} className={`bubble bubble--${m.role}`}>
              {m.text || (streaming && i === messages.length - 1 ? "…" : "")}
            </div>
          ))
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
