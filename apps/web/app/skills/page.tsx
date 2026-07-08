"use client";

import { BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Skill = { name: string; description: string };

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/skills`)
      .then((r) => r.json() as Promise<Skill[]>)
      .then(setSkills)
      .catch(() => setError("Failed to load skills"));
  }, []);

  useEffect(load, [load]);

  async function remove(name: string) {
    if (!confirm(`Delete skill "${name}"?`)) return;
    await fetch(`${API_BASE}/skills/${name}`, { method: "DELETE" });
    load();
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Skills</h1>
        <Button size="sm" render={<Link href="/skills/new" />} nativeButton={false}>
          <Plus /> New skill
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {skills === null ? (
        <p className="py-6 text-sm text-muted-foreground">Loading skills…</p>
      ) : skills.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No skills yet — create one to give agents reusable instructions.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {skills.map((skill) => (
            <li
              key={skill.name}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-ring"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                <BookOpen className="size-4 text-muted-foreground" />
              </div>
              <Link href={`/skills/${skill.name}`} className="min-w-0 flex-1">
                <p className="font-medium">{skill.name}</p>
                <p className="truncate text-sm text-muted-foreground">{skill.description}</p>
              </Link>
              <Button variant="ghost" size="sm" onClick={() => remove(skill.name)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
