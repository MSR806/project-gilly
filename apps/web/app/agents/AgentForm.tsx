"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import MultiSelect, { type Group } from "../components/MultiSelect";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

/**
 * High-level Gilly tool capabilities the agent may be granted. These abstractions are what we store
 * and show; the harness maps them to concrete SDK tools. Any tool (or skill) gives the agent a
 * per-session workspace; see the harness loop.
 */
const TOOL_GROUPS: Group[] = [
  {
    label: "",
    options: [
      { value: "Read", description: "read files and search the workspace" },
      { value: "Write", description: "create and edit files" },
      { value: "Bash", description: "run shell commands" },
    ],
  },
];

export type AgentValues = {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  tools?: string[];
  skills?: string[];
};

const EMPTY: AgentValues = { id: "", name: "", model: "claude-sonnet-4-5", systemPrompt: "" };

/** Derive a URL-safe handle from the agent's name (lowercase, hyphenated). */
const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function AgentForm({
  mode,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: AgentValues;
  /** Called with the saved config instead of navigating away (used by the detail page). */
  onSaved?: (agent: AgentValues) => void;
  /** Called instead of navigating home on cancel. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<AgentValues>(initial ?? EMPTY);
  const [allSkills, setAllSkills] = useState<{ name: string; description: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/skills`)
      .then((r) => r.json() as Promise<{ name: string; description: string }[]>)
      .then(setAllSkills)
      .catch(() => setAllSkills([]));
  }, []);

  const set = <K extends keyof AgentValues>(key: K, value: AgentValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // On create the handle is derived from the name; on edit it's fixed (it's the address).
    const id = mode === "create" ? slugify(values.name) : values.id;
    if (!id) {
      setError("Enter a name with at least one letter or number.");
      return;
    }
    setSaving(true);
    const payload = {
      ...values,
      id,
      tools: values.tools?.length ? values.tools : undefined,
      skills: values.skills?.length ? values.skills : undefined,
    };
    const url = mode === "create" ? `${API_BASE}/agents` : `${API_BASE}/agents/${id}`;
    try {
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      if (onSaved) onSaved({ ...values, id });
      else router.push(mode === "create" ? `/chat/${id}` : "/");
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
          required
          placeholder="Coder"
          onChange={(e) => set("name", e.target.value)}
        />
        {mode === "create" ? (
          <span className="field__hint">
            Handle: <code>{slugify(values.name) || "…"}</code> (auto-generated, used in the URL)
          </span>
        ) : (
          <span className="field__hint">
            Handle: <code>{values.id}</code> (fixed)
          </span>
        )}
      </label>

      <label className="field">
        <span className="field__label">Model</span>
        <input value={values.model} required onChange={(e) => set("model", e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">System prompt</span>
        <textarea
          value={values.systemPrompt}
          required
          rows={5}
          placeholder="Role, scope, and style — not the task."
          onChange={(e) => set("systemPrompt", e.target.value)}
        />
      </label>

      <div className="field">
        <span className="field__label">Tools</span>
        <MultiSelect
          groups={TOOL_GROUPS}
          selected={values.tools ?? []}
          onChange={(tools) => set("tools", tools)}
          placeholder="No tools (chat-only)"
        />
      </div>

      <div className="field">
        <span className="field__label">Skills</span>
        {allSkills.length === 0 ? (
          <p className="field__hint">No skills yet — create one to attach it.</p>
        ) : (
          <MultiSelect
            groups={[
              {
                label: "Skills",
                options: allSkills.map((s) => ({ value: s.name, description: s.description })),
              },
            ]}
            selected={values.skills ?? []}
            onChange={(skills) => set("skills", skills)}
            placeholder="No skills attached"
          />
        )}
      </div>

      {error ? <p className="state state--error">{error}</p> : null}

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? "Saving…" : mode === "create" ? "Create & chat" : "Save"}
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
