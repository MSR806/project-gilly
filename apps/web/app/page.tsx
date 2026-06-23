"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Agent = { id: string; name: string; model: string };
type Skill = { name: string; description: string };

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/agents`)
      .then((r) => r.json() as Promise<Agent[]>)
      .then(setAgents)
      .catch(() => setError("Failed to load agents"));
    fetch(`${API_BASE}/skills`)
      .then((r) => r.json() as Promise<Skill[]>)
      .then(setSkills)
      .catch(() => setError("Failed to load skills"));
  }, []);

  useEffect(load, [load]);

  async function remove(kind: "agents" | "skills", key: string) {
    if (!confirm(`Delete ${kind.slice(0, -1)} "${key}"?`)) return;
    await fetch(`${API_BASE}/${kind}/${key}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      {error ? <p className="state state--error">{error}</p> : null}

      <section className="section">
        <div className="section__head">
          <h1 className="page-title">Agents</h1>
          <Link href="/agents/new" className="btn btn--primary">
            + New agent
          </Link>
        </div>
        {agents === null ? (
          <p className="state">Loading agents…</p>
        ) : agents.length === 0 ? (
          <p className="state">No agents yet.</p>
        ) : (
          <ul className="card-list">
            {agents.map((agent) => (
              <li key={agent.id} className="card row">
                <Link href={`/agents/${agent.id}`} className="row__main">
                  <p className="card__name">{agent.name}</p>
                  <div className="card__meta">
                    <span>
                      ID: <code>{agent.id}</code>
                    </span>
                    <span>
                      Model: <code>{agent.model}</code>
                    </span>
                  </div>
                </Link>
                <div className="row__actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => remove("agents", agent.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h1 className="page-title">Skills</h1>
          <Link href="/skills/new" className="btn btn--primary">
            + New skill
          </Link>
        </div>
        {skills === null ? (
          <p className="state">Loading skills…</p>
        ) : skills.length === 0 ? (
          <p className="state">No skills yet.</p>
        ) : (
          <ul className="card-list">
            {skills.map((skill) => (
              <li key={skill.name} className="card row">
                <Link href={`/skills/${skill.name}`} className="row__main">
                  <p className="card__name">{skill.name}</p>
                  <div className="card__meta">
                    <span>{skill.description}</span>
                  </div>
                </Link>
                <div className="row__actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => remove("skills", skill.name)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
