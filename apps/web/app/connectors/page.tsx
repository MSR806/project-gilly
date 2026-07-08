"use client";

import { Cable } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Connector = {
  name: string;
  kind: "api" | "mcp";
  auth: "none" | "api_key" | "oauth";
  connected: boolean;
  requiredCreds: string[];
  toolCount?: number;
};

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/connectors`)
      .then((r) => r.json() as Promise<{ connectors: Connector[] }>)
      .then((d) => setConnectors(d.connectors))
      .catch(() => setError("Failed to load tools"));
  }, []);

  useEffect(load, [load]);

  // ?connected=<provider> is set by the OAuth callback bounce — show a brief success note.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("connected");
    if (p) setJustConnected(p);
  }, []);

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Tools</h1>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {justConnected ? (
        <p className="mb-4 text-sm text-green-700 dark:text-green-400">
          Connected {justConnected}. It may take a moment to reflect.
        </p>
      ) : null}

      {connectors === null ? (
        <p className="py-6 text-sm text-muted-foreground">Loading tools…</p>
      ) : connectors.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No tools configured.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {connectors.map((c) => (
            <ConnectorCard key={c.name} connector={c} onChange={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectorCard({ connector, onChange }: { connector: Connector; onChange: () => void }) {
  const { name, auth, connected, requiredCreds } = connector;
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
          <Cable className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`size-2 rounded-full ${connected ? "bg-green-500" : "bg-destructive"}`}
              />
              {connected ? "Connected" : "Not connected"}
            </span>
            <span>auth: {auth}</span>
            {connector.toolCount !== undefined ? <span>{connector.toolCount} tools</span> : null}
          </div>
        </div>
        {auth === "oauth" ? <OAuthConnect name={name} connected={connected} /> : null}
      </div>

      {auth === "none" ? (
        <p className="mt-3 text-xs text-muted-foreground">No setup needed.</p>
      ) : null}

      {auth === "api_key" ? (
        <div className="mt-4 flex flex-col gap-3 border-t pt-4">
          {requiredCreds.map((key) => (
            <ApiKeyField
              key={key}
              name={name}
              credKey={key}
              connected={connected}
              onSaved={onChange}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function ApiKeyField({
  name,
  credKey,
  connected,
  onSaved,
}: {
  name: string;
  credKey: string;
  connected: boolean;
  onSaved: () => void;
}) {
  // Once connected, keep the input collapsed behind an "Update" toggle — never render stored values.
  const [editing, setEditing] = useState(!connected);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/connectors/${name}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: credKey, value }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setValue("");
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-4">
        <span className="flex-1 text-sm font-medium">{credKey}</span>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Update
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={`cred-${name}-${credKey}`}>{credKey}</Label>
      <div className="flex gap-2">
        <Input
          id={`cred-${name}-${credKey}`}
          type="password"
          value={value}
          placeholder={`Paste ${credKey}`}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <Button onClick={save} disabled={saving || !value}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

function OAuthConnect({ name, connected }: { name: string; connected: boolean }) {
  // Full-page navigation (not fetch) so the gateway → Atlassian redirect chain works in the browser.
  const connect = () => {
    window.location.href = `${API_BASE}/connectors/${name}/connect`;
  };
  return (
    <Button variant={connected ? "outline" : "default"} size="sm" onClick={connect}>
      {connected ? "Reconnect" : "Connect"}
    </Button>
  );
}
