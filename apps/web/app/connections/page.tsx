"use client";

import { MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Connection = {
  id: string;
  name: string;
  agentId: string;
  teamName?: string;
  status: "active" | "disabled" | "error";
  lastError?: string;
};

const DOT: Record<Connection["status"], string> = {
  active: "bg-green-500",
  disabled: "bg-muted-foreground",
  error: "bg-destructive",
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/slack/connections`)
      .then((r) => r.json() as Promise<Connection[]>)
      .then(setConnections)
      .catch(() => setError("Failed to load channels"));
  }, []);

  useEffect(load, [load]);

  async function remove(c: Connection) {
    if (!confirm(`Delete channel "${c.name}"? The bot will stop responding.`)) return;
    await fetch(`${API_BASE}/slack/connections/${c.id}`, { method: "DELETE" });
    load();
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Channels</h1>
        <Button size="sm" render={<Link href="/connections/new" />} nativeButton={false}>
          <Plus /> New channel
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {connections === null ? (
        <p className="py-6 text-sm text-muted-foreground">Loading channels…</p>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg border bg-background">
            <MessageSquare className="size-5 text-muted-foreground" />
          </div>
          <p className="font-medium">Connect a Slack workspace</p>
          <p className="text-sm text-muted-foreground">
            Create a Slack app, paste its tokens, and bind it to one of your agents.
          </p>
          <Link href="/connections/new" className="mt-2 text-sm font-medium text-primary">
            Get started →
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {connections.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-ring"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                <MessageSquare className="size-4 text-muted-foreground" />
              </div>
              <Link href={`/connections/${c.id}`} className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${DOT[c.status]}`} />
                    {c.status}
                  </span>
                  {c.teamName ? <span>{c.teamName}</span> : null}
                  <span>
                    agent: <code className="font-mono text-xs">{c.agentId}</code>
                  </span>
                </div>
                {c.status === "error" && c.lastError ? (
                  <p className="mt-1 truncate text-xs text-destructive">{c.lastError}</p>
                ) : null}
              </Link>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={`/connections/${c.id}`} />}
                  nativeButton={false}
                >
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(c)}>
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
