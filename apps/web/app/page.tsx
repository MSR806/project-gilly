"use client";

import { useEffect, useState } from "react";

type Agent = {
  id: string;
  name: string;
  model: string;
};

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/agents")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }
        return res.json() as Promise<Agent[]>;
      })
      .then((data) => {
        if (!cancelled) setAgents(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load agents");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <h1 className="page-title">Agents</h1>

      {error ? (
        <p className="state state--error">Couldn’t load agents: {error}</p>
      ) : agents === null ? (
        <p className="state">Loading agents…</p>
      ) : agents.length === 0 ? (
        <p className="state">No agents yet.</p>
      ) : (
        <ul className="card-list">
          {agents.map((agent) => (
            <li key={agent.id} className="card">
              <p className="card__name">{agent.name}</p>
              <div className="card__meta">
                <span>
                  ID: <code>{agent.id}</code>
                </span>
                <span>
                  Model: <code>{agent.model}</code>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
