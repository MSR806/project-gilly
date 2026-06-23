"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export type SkillValues = { name: string; description: string; content: string };

const EMPTY: SkillValues = { name: "", description: "", content: "" };

export default function SkillForm({
  mode,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: SkillValues;
  /** Called with the saved values instead of navigating away (used by the detail page). */
  onSaved?: (skill: SkillValues) => void;
  /** Called instead of navigating home on cancel. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SkillValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof SkillValues>(key: K, value: SkillValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const url = mode === "create" ? `${API_BASE}/skills` : `${API_BASE}/skills/${values.name}`;
    try {
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      if (onSaved) onSaved(values);
      else router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Name</span>
        <input
          value={values.name}
          disabled={mode === "edit"}
          required
          placeholder="our-repos"
          onChange={(e) => set("name", e.target.value)}
        />
        <span className="field__hint">
          Lowercase letters, digits, hyphens. Becomes the folder name.
        </span>
      </label>

      <label className="field">
        <span className="field__label">Description</span>
        <textarea
          value={values.description}
          required
          rows={2}
          placeholder="When should the agent use this skill?"
          onChange={(e) => set("description", e.target.value)}
        />
        <span className="field__hint">Shown to the agent to decide when to load the skill.</span>
      </label>

      <label className="field">
        <span className="field__label">Content (SKILL.md body)</span>
        <textarea
          value={values.content}
          required
          rows={14}
          placeholder="# My Skill&#10;&#10;Instructions in Markdown…"
          onChange={(e) => set("content", e.target.value)}
        />
      </label>

      {error ? <p className="state state--error">{error}</p> : null}

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? "Saving…" : mode === "create" ? "Create skill" : "Save"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => (onCancel ? onCancel() : router.push("/"))}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
