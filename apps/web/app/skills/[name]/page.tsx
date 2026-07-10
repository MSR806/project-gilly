"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex flex-col gap-6">
      <Link href="/skills" className="text-sm text-muted-foreground hover:text-foreground">
        ← Skills
      </Link>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : skill === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-card">
              <BookOpen className="size-6 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">{skill.name}</h1>
              <p className="truncate text-sm text-muted-foreground">{skill.description}</p>
            </div>
            {!editing ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
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
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{skill.description}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>SKILL.md</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">
                    {skill.content}
                  </pre>
                </CardContent>
              </Card>

              {skill.files?.map((f) => (
                <Card key={f.path}>
                  <CardHeader>
                    <CardTitle className="font-mono text-sm">{f.path}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">
                      {f.contents}
                    </pre>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
