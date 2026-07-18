"use client";

import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronLeft,
  History,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  SendHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type ActivityItem, groupActivity } from "./activity";
import {
  appendActivityPart,
  type ConversationSummary,
  type HistoryRun,
  type Message,
  messagesFromRuns,
  type Part,
} from "./history";
import { type Activity, activityFor, parseSseStream } from "./sse";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

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

export function ActivityBlock({ items, running }: { items: ActivityItem[]; running: boolean }) {
  const groups = groupActivity(items);
  const visibleGroups = running ? groups.slice(-5) : groups;
  const omittedGroups = groups.length - visibleGroups.length;
  return (
    <details
      open={running || undefined}
      className="group rounded-lg border border-border/60 bg-muted/30 text-xs text-muted-foreground"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-foreground marker:content-none">
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 -rotate-90 transition-transform group-open:rotate-0" />
        )}
        <span>
          {running ? "Working" : "Activity"} · {items.length}{" "}
          {items.length === 1 ? "step" : "steps"}
        </span>
      </summary>
      <div className="space-y-1 border-t border-border/60 px-3 py-2">
        {omittedGroups > 0 ? (
          <p className="text-muted-foreground/80">{omittedGroups} earlier groups</p>
        ) : null}
        {visibleGroups.map((group, index) => (
          <div
            key={`${group.label}:${group.detail}:${index}`}
            className="flex min-w-0 gap-2 leading-5"
          >
            <span className="shrink-0 font-medium text-foreground">{group.label}</span>
            {group.detail ? <span className="min-w-0 truncate">· {group.detail}</span> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function ChatPageContent() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const router = useRouter();
  const requestedConversationId = useSearchParams().get("conversation") ?? undefined;

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [agentName, setAgentName] = useState<string | undefined>();
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<Activity>(null);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const loadedConversationKey = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function refreshConversations() {
    const res = await fetch(`${API_BASE}/chat/sessions?agentId=${encodeURIComponent(agentId)}`);
    if (!res.ok) throw new Error(`Could not load conversations (${res.status})`);
    setConversations((await res.json()) as ConversationSummary[]);
  }

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_BASE}/chat/sessions?agentId=${encodeURIComponent(agentId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load conversations (${res.status})`);
        return res.json() as Promise<ConversationSummary[]>;
      })
      .then((items) => {
        if (!cancelled) setConversations(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load history");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    setAgentName(undefined);
    void fetch(`${API_BASE}/agents/${encodeURIComponent(agentId)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ name: string }>) : undefined))
      .then((agent) => {
        if (!cancelled && agent?.name) setAgentName(agent.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    if (!requestedConversationId) {
      conversationId.current = undefined;
      loadedConversationKey.current = undefined;
      setActiveConversationId(undefined);
      setMessages([]);
      setHistoryLoading(false);
      return;
    }

    const key = `${agentId}:${requestedConversationId}`;
    if (loadedConversationKey.current === key) return;
    loadedConversationKey.current = key;
    conversationId.current = requestedConversationId;
    setActiveConversationId(requestedConversationId);
    setHistoryLoading(true);
    setError(null);
    const request = new AbortController();
    let cancelled = false;
    void fetch(
      `${API_BASE}/chat/sessions/${encodeURIComponent(requestedConversationId)}?agentId=${encodeURIComponent(agentId)}`,
      { signal: request.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load conversation (${res.status})`);
        return res.json() as Promise<{ runs: HistoryRun[] }>;
      })
      .then(({ runs }) => {
        if (!cancelled) setMessages(messagesFromRuns(runs));
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof Error && err.name === "AbortError")) {
          if (loadedConversationKey.current === key) loadedConversationKey.current = undefined;
          setError(err instanceof Error ? err.message : "Could not load conversation");
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
      request.abort();
    };
  }, [agentId, requestedConversationId]);

  function newChat() {
    conversationId.current = undefined;
    loadedConversationKey.current = undefined;
    setActiveConversationId(undefined);
    setMessages([]);
    setError(null);
    setHistoryOpen(false);
    router.push(`/chat/${encodeURIComponent(agentId)}`);
  }

  function openConversation(id: string) {
    setHistoryOpen(false);
    router.push(`/chat/${encodeURIComponent(agentId)}?conversation=${encodeURIComponent(id)}`);
  }

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
      updateAssistant((parts) => appendActivityPart(parts, { name, summary }));

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
      if (cid) {
        conversationId.current = cid;
        loadedConversationKey.current = `${agentId}:${cid}`;
        setActiveConversationId(cid);
        router.replace(
          `/chat/${encodeURIComponent(agentId)}?conversation=${encodeURIComponent(cid)}`,
        );
      }

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
      void refreshConversations().catch(() => undefined);
    }
  }

  return (
    <div className="flex h-[calc(100svh-5rem)] min-h-[32rem] flex-col overflow-hidden bg-background text-foreground md:h-[calc(100svh-3rem)]">
      <div className="flex shrink-0 items-center justify-between pb-4 text-sm text-muted-foreground">
        <Link
          href="/agents"
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Agents
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 items-center gap-2 rounded-full bg-muted px-3 py-1.5">
            <Bot className="size-3.5 shrink-0 text-foreground" />
            <span className="truncate font-medium text-foreground">{agentName ?? agentId}</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="md:hidden"
            aria-label="Open conversation history"
            aria-expanded={historyOpen}
            aria-controls="conversation-history"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History />
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {historyOpen ? (
          <button
            type="button"
            aria-label="Close conversation history"
            className="fixed inset-0 z-10 bg-black/15 md:hidden"
            onClick={() => setHistoryOpen(false)}
          />
        ) : null}
        <aside
          id="conversation-history"
          className={`fixed inset-y-0 right-0 z-30 h-svh shrink-0 flex-col border-l bg-background py-4 transition-[width] duration-200 ${
            historyOpen ? "flex w-72 px-4 shadow-xl md:w-64" : "hidden md:flex md:w-12 md:px-2"
          }`}
        >
          <div
            className={`flex items-center pb-3 text-sm font-medium ${
              historyOpen ? "justify-between" : "justify-center"
            }`}
          >
            {historyOpen ? (
              <span className="flex items-center gap-2">
                <History className="size-4" />
                Conversations
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                historyOpen ? "Collapse conversation history" : "Expand conversation history"
              }
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              {historyOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </div>
          {historyOpen ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="mb-3 w-full justify-start"
                onClick={newChat}
                disabled={streaming}
              >
                <Plus />
                New chat
              </Button>
              <nav className="min-h-0 space-y-1 overflow-y-auto" aria-label="Past conversations">
                {conversations.map((conversation) => (
                  <button
                    type="button"
                    key={conversation.conversationId}
                    disabled={streaming}
                    onClick={() => openConversation(conversation.conversationId)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50 ${
                      activeConversationId === conversation.conversationId ? "bg-muted" : ""
                    }`}
                  >
                    <span className="block truncate text-sm">{conversation.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {new Date(conversation.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </button>
                ))}
                {conversations.length === 0 ? (
                  <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
                    Your completed conversations will appear here.
                  </p>
                ) : null}
              </nav>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              onClick={newChat}
              disabled={streaming}
            >
              <Plus />
            </Button>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div ref={listRef} className="flex flex-1 flex-col gap-8 overflow-y-auto px-1 py-4">
            {historyLoading ? (
              <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading conversation…
              </div>
            ) : messages.length === 0 ? (
              <div className="m-auto max-w-sm text-center">
                <h1 className="text-xl font-medium">What can I help you investigate?</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Ask a question and follow the response and tool activity here.
                </p>
              </div>
            ) : (
              messages.map((message, i) => {
                const isLast = i === messages.length - 1;
                const hasActivity = message.parts.some((part) => part.kind === "activity");
                return (
                  <div
                    key={i}
                    className={
                      message.role === "user"
                        ? "max-w-[75%] self-end whitespace-pre-wrap break-words rounded-2xl bg-muted px-5 py-3.5 text-[15px] leading-7 text-foreground"
                        : "w-full space-y-4 text-[15px] leading-7 text-foreground"
                    }
                  >
                    {message.parts.map((part, j) => {
                      if (part.kind === "text") {
                        return message.role === "assistant" ? (
                          <Markdown key={j}>{part.text}</Markdown>
                        ) : (
                          <p key={j}>{part.text}</p>
                        );
                      }
                      if (part.kind === "error") {
                        return (
                          <div key={j} className="flex items-start gap-2 text-sm text-destructive">
                            <AlertCircle className="mt-0.5 size-4 shrink-0" />
                            <span>{part.error}</span>
                          </div>
                        );
                      }
                      return (
                        <ActivityBlock
                          key={j}
                          items={part.items}
                          running={streaming && isLast && j === message.parts.length - 1}
                        />
                      );
                    })}
                    {streaming && isLast && !hasActivity ? (
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
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
            <div className="rounded-[18px] border border-input bg-card p-3 shadow-sm transition-colors focus-within:border-ring">
              <Textarea
                ref={inputRef}
                disabled={streaming || historyLoading}
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
                  <Button type="submit" className="h-9 gap-2 px-4" disabled={historyLoading}>
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
        </section>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageContent />
    </Suspense>
  );
}
