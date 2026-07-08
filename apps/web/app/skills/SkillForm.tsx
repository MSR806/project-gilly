"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
      else router.push("/skills");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <form className="flex max-w-2xl flex-col gap-5" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="skill-name">Name</Label>
        <Input
          id="skill-name"
          value={values.name}
          disabled={mode === "edit"}
          required
          placeholder="our-repos"
          onChange={(e) => set("name", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, digits, hyphens. Becomes the folder name.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="skill-description">Description</Label>
        <Textarea
          id="skill-description"
          value={values.description}
          required
          rows={2}
          placeholder="When should the agent use this skill?"
          onChange={(e) => set("description", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Shown to the agent to decide when to load the skill.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="skill-content">Content (SKILL.md body)</Label>
        <Textarea
          id="skill-content"
          value={values.content}
          required
          rows={14}
          placeholder="# My Skill&#10;&#10;Instructions in Markdown…"
          onChange={(e) => set("content", e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : mode === "create" ? "Create skill" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => (onCancel ? onCancel() : router.push("/skills"))}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
