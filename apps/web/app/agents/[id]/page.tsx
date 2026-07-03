"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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
    <>
      <Link href="/" className="chat__back">
        ← Agents
      </Link>

      {error ? (
        <p className="state state--error">{error}</p>
      ) : agent === null ? (
        <p className="state">Loading…</p>
      ) : (
        <>
          <div className="section__head">
            <h1 className="page-title">Agent: {agent.name}</h1>
            {!editing ? (
              <div className="row__actions">
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <Link href={`/chat/${agent.id}`} className="btn btn--primary">
                  Chat
                </Link>
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
            <dl className="detail">
              <Row label="ID">
                <code>{agent.id}</code>
              </Row>
              <Row label="Model">
                <code>{agent.model}</code>
              </Row>
              <Row label="Tools">
                <Chips items={agent.tools} empty="None (chat-only)" />
              </Row>
              <Row label="Skills">
                <Chips items={agent.skills} empty="None" />
              </Row>
              <Row label="Connectors">
                <Chips items={agent.connectors} empty="None" />
              </Row>
              <Row label="System prompt">
                <p className="detail__prompt">{agent.systemPrompt}</p>
              </Row>
            </dl>
          )}
        </>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail__row">
      <dt className="detail__label">{label}</dt>
      <dd className="detail__value">{children}</dd>
    </div>
  );
}

function Chips({ items, empty }: { items?: string[]; empty: string }) {
  if (!items?.length) return <span className="detail__muted">{empty}</span>;
  return (
    <span className="ms__chips">
      {items.map((item) => (
        <span key={item} className="ms__chip">
          {item}
        </span>
      ))}
    </span>
  );
}
