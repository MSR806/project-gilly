"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import SkillForm, { type SkillValues } from "../SkillForm";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export default function SkillDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [skill, setSkill] = useState<SkillValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/skills/${name}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<SkillValues>;
      })
      .then(setSkill)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load skill"));
  }, [name]);

  return (
    <>
      <Link href="/" className="chat__back">
        ← Skills
      </Link>

      {error ? (
        <p className="state state--error">{error}</p>
      ) : skill === null ? (
        <p className="state">Loading…</p>
      ) : (
        <>
          <div className="section__head">
            <h1 className="page-title">Skill: {skill.name}</h1>
            {!editing ? (
              <div className="row__actions">
                <button type="button" className="btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
              </div>
            ) : null}
          </div>

          {editing ? (
            <SkillForm
              mode="edit"
              initial={skill}
              onSaved={(s) => {
                setSkill(s);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <dl className="detail">
              <div className="detail__row">
                <dt className="detail__label">Name</dt>
                <dd className="detail__value">
                  <code>{skill.name}</code>
                </dd>
              </div>
              <div className="detail__row">
                <dt className="detail__label">Description</dt>
                <dd className="detail__value">{skill.description}</dd>
              </div>
              <div className="detail__row">
                <dt className="detail__label">Content</dt>
                <dd className="detail__value">
                  <pre className="detail__content">{skill.content}</pre>
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
    </>
  );
}
