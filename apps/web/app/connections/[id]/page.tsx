"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ConnectionForm from "../ConnectionForm";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Connection = { id: string; name: string; agentId: string; teamName?: string };

export default function ConnectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [conn, setConn] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/slack/connections/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<Connection>;
      })
      .then(setConn)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load channel"));
  }, [id]);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/connections" className="text-sm text-muted-foreground hover:text-foreground">
        ← Channels
      </Link>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : conn === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight">{conn.name}</h1>
          <ConnectionForm
            mode="edit"
            id={conn.id}
            initial={{ name: conn.name, agentId: conn.agentId }}
            onSaved={() => router.push("/connections")}
          />
        </>
      )}
    </div>
  );
}
