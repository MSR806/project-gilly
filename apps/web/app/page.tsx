"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Agent = { id: string; name: string; model: string; tools: string[]; skills: string[] };
type Skill = { name: string; preview: string };

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Create Skill form state ─────────────────────────────────────────
  const [skillName, setSkillName] = useState("");
  const [skillContent, setSkillContent] = useState("");
  const [skillMsg, setSkillMsg] = useState<string | null>(null);

  // ─── Create Agent form state ─────────────────────────────────────────
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentModel, setAgentModel] = useState("sonnet");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentTools, setAgentTools] = useState("");
  const [agentSkills, setAgentSkills] = useState<string[]>([]);
  const [agentMsg, setAgentMsg] = useState<string | null>(null);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/agents").then((r) => {
        if (!r.ok) throw new Error(`Agents request failed (${r.status})`);
        return r.json() as Promise<Agent[]>;
      }),
      fetch("/api/skills").then((r) => {
        if (!r.ok) throw new Error(`Skills request failed (${r.status})`);
        return r.json() as Promise<Skill[]>;
      }),
    ])
      .then(([a, s]) => {
        if (!cancelled) {
          setAgents(a);
          setSkills(s);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────

  async function handleCreateSkill(e: React.FormEvent) {
    e.preventDefault();
    setSkillMsg(null);
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: skillName.trim(), content: skillContent }),
    });
    const body = await res.json();
    if (!res.ok) {
      setSkillMsg(`Error: ${body.error}`);
      return;
    }
    setSkills((prev) => [...(prev ?? []), body]);
    setSkillName("");
    setSkillContent("");
    setSkillMsg(`Skill "${body.name}" created.`);
  }

  async function handleCreateAgent(e: React.FormEvent) {
    e.preventDefault();
    setAgentMsg(null);
    setCreatedAgentId(null);
    const tools = agentTools
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = {
      id: agentId.trim(),
      name: agentName.trim(),
      model: agentModel.trim(),
      systemPrompt: agentPrompt,
      ...(tools.length ? { tools } : {}),
      ...(agentSkills.length ? { skills: agentSkills } : {}),
    };
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      setAgentMsg(`Error: ${body.error}`);
      return;
    }
    setAgents((prev) => [...(prev ?? []), body]);
    setCreatedAgentId(body.id);
    setAgentMsg(`Agent "${body.name}" created.`);
    setAgentId("");
    setAgentName("");
    setAgentModel("sonnet");
    setAgentPrompt("");
    setAgentTools("");
    setAgentSkills([]);
  }

  function toggleSkill(name: string) {
    setAgentSkills((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────

  if (error) return <p className="state state--error">Couldn&apos;t load data: {error}</p>;
  if (agents === null || skills === null) return <p className="state">Loading...</p>;

  return (
    <>
      {/* ─── Agents ──────────────────────────────────────────────────── */}
      <section className="section">
        <h1 className="page-title">Agents</h1>
        {agents.length === 0 ? (
          <p className="state">No agents yet.</p>
        ) : (
          <ul className="card-list">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link href={`/chat/${agent.id}`} className="card card--link">
                  <p className="card__name">{agent.name}</p>
                  <div className="card__meta">
                    <span>
                      ID: <code>{agent.id}</code>
                    </span>
                    <span>
                      Model: <code>{agent.model}</code>
                    </span>
                  </div>
                  {agent.skills && agent.skills.length > 0 && (
                    <div className="card__chips">
                      {agent.skills.map((s) => (
                        <span key={s} className="chip">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Skills ──────────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="page-title">Skills</h2>
        {skills.length === 0 ? (
          <p className="state">No skills yet.</p>
        ) : (
          <ul className="card-list">
            {skills.map((skill) => (
              <li key={skill.name}>
                <div className="card">
                  <p className="card__name">{skill.name}</p>
                  <p className="card__preview">{skill.preview}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Create Skill ────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="page-title">Create Skill</h2>
        <form className="form" onSubmit={handleCreateSkill}>
          <label className="form__label">
            Name
            <input
              className="form__input"
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="my-skill"
              required
            />
          </label>
          <label className="form__label">
            SKILL.md content
            <textarea
              className="form__textarea"
              value={skillContent}
              onChange={(e) => setSkillContent(e.target.value)}
              placeholder="# My Skill&#10;Description and instructions..."
              rows={6}
              required
            />
          </label>
          <button className="form__button" type="submit">
            Create Skill
          </button>
          {skillMsg && <p className="form__msg">{skillMsg}</p>}
        </form>
      </section>

      {/* ─── Create Agent ────────────────────────────────────────────── */}
      <section className="section">
        <h2 className="page-title">Create Agent</h2>
        <form className="form" onSubmit={handleCreateAgent}>
          <label className="form__label">
            ID
            <input
              className="form__input"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="my-agent"
              required
            />
          </label>
          <label className="form__label">
            Name
            <input
              className="form__input"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="My Agent"
              required
            />
          </label>
          <label className="form__label">
            Model
            <input
              className="form__input"
              value={agentModel}
              onChange={(e) => setAgentModel(e.target.value)}
              placeholder="sonnet"
              required
            />
          </label>
          <label className="form__label">
            System Prompt
            <textarea
              className="form__textarea"
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              placeholder="You are a helpful assistant..."
              rows={4}
              required
            />
          </label>
          <label className="form__label">
            Tools (comma-separated)
            <input
              className="form__input"
              value={agentTools}
              onChange={(e) => setAgentTools(e.target.value)}
              placeholder="Read, Write, Bash"
            />
          </label>
          {skills.length > 0 && (
            <fieldset className="form__fieldset">
              <legend>Attach Skills</legend>
              {skills.map((s) => (
                <label key={s.name} className="form__checkbox">
                  <input
                    type="checkbox"
                    checked={agentSkills.includes(s.name)}
                    onChange={() => toggleSkill(s.name)}
                  />
                  {s.name}
                </label>
              ))}
            </fieldset>
          )}
          <button className="form__button" type="submit">
            Create Agent
          </button>
          {agentMsg && <p className="form__msg">{agentMsg}</p>}
          {createdAgentId && (
            <Link href={`/chat/${createdAgentId}`} className="form__chat-link">
              Chat with {createdAgentId}
            </Link>
          )}
        </form>
      </section>
    </>
  );
}
