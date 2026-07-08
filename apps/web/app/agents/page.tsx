"use client";

import { Bot, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Agent = { id: string; name: string; model: string };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/agents`)
      .then((r) => r.json() as Promise<Agent[]>)
      .then(setAgents)
      .catch(() => setError("Failed to load agents"));
  }, []);

  useEffect(load, [load]);

  async function remove(id: string) {
    if (!confirm(`Delete agent "${id}"?`)) return;
    await fetch(`${API_BASE}/agents/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
        <Button size="sm" render={<Link href="/agents/new" />} nativeButton={false}>
          <Plus /> New agent
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {agents === null ? (
        <p className="py-6 text-sm text-muted-foreground">Loading agents…</p>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg border bg-background">
            <Sparkles className="size-5 text-muted-foreground" />
          </div>
          <p className="font-medium">Set up your first agent</p>
          <p className="text-sm text-muted-foreground">
            Takes about 30 seconds — give it a name, a model, and a prompt.
          </p>
          <Link href="/agents/new" className="mt-2 text-sm font-medium text-primary">
            Get started →
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-ring"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                <Bot className="size-4 text-muted-foreground" />
              </div>
              <Link href={`/agents/${agent.id}`} className="min-w-0 flex-1">
                <p className="font-medium">{agent.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  <code className="font-mono text-xs">{agent.id}</code>
                  <span className="mx-2">·</span>
                  <code className="font-mono text-xs">{agent.model}</code>
                </p>
              </Link>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={`/chat/${agent.id}`} />}
                  nativeButton={false}
                >
                  Chat
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(agent.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
