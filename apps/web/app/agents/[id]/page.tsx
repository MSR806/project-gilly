"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AgentForm, { type AgentValues } from "../AgentForm";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/agents/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<AgentValues>;
      })
      .then(setAgent)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load agent"));
  }, [id]);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/agents" className="text-sm text-muted-foreground hover:text-foreground">
        ← Agents
      </Link>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : agent === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-card">
              <Bot className="size-6 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
              <p className="text-sm text-muted-foreground">
                <code className="font-mono text-xs">{agent.id}</code>
                <span className="mx-2">·</span>
                <code className="font-mono text-xs">{agent.model}</code>
              </p>
            </div>
            {!editing ? (
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button size="sm" render={<Link href={`/chat/${agent.id}`} />} nativeButton={false}>
                  Chat
                </Button>
              </div>
            ) : null}
          </div>

          {editing ? (
            <AgentForm
              mode="edit"
              initial={agent}
              onSaved={(a) => {
                setAgent(a);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Capabilities</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <CapabilityRow
                    label="Built-in tools"
                    items={agent.tools}
                    empty="None (chat-only)"
                  />
                  <CapabilityRow
                    label="Skills"
                    items={agent.skills}
                    empty="None"
                    href={(skill) => `/skills/${skill}`}
                  />
                  <CapabilityRow
                    label="Tools"
                    items={agent.connectors}
                    empty="None"
                    href={() => "/connectors"}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>System prompt</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {agent.systemPrompt}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CapabilityRow({
  label,
  items,
  empty,
  href,
}: {
  label: string;
  items?: string[];
  empty: string;
  /** When set, each badge links to href(item). */
  href?: (item: string) => string;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-4">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {items?.length ? (
        <span className="flex flex-wrap gap-1.5">
          {items.map((item) =>
            href ? (
              <Link key={item} href={href(item)}>
                <Badge variant="secondary" className="hover:bg-muted hover:underline">
                  {item}
                </Badge>
              </Link>
            ) : (
              <Badge key={item} variant="secondary">
                {item}
              </Badge>
            ),
          )}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">{empty}</span>
      )}
    </div>
  );
}
