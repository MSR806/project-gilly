"use client";

import { useCallback, useEffect, useState } from "react";

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
      .catch(() => setError("Failed to load connectors"));
  }, []);

  useEffect(load, [load]);

  // ?connected=<provider> is set by the OAuth callback bounce — show a brief success note.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("connected");
    if (p) setJustConnected(p);
  }, []);

  return (
    <section className="section">
      <div className="section__head">
        <h1 className="page-title">Connectors</h1>
      </div>

      {error ? <p className="state state--error">{error}</p> : null}
      {justConnected ? (
        <p className="state state--ok">
          Connected {justConnected}. It may take a moment to reflect.
        </p>
      ) : null}

      {connectors === null ? (
        <p className="state">Loading connectors…</p>
      ) : connectors.length === 0 ? (
        <p className="state">No connectors configured.</p>
      ) : (
        <ul className="card-list">
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
    <li className="card">
      <div className="row">
        <div className="row__main">
          <p className="card__name">{name}</p>
          <div className="card__meta">
            <span className={`badge ${connected ? "badge--ok" : "badge--off"}`}>
              {connected ? "Connected" : "Not connected"}
            </span>
            <span>auth: {auth}</span>
            {connector.toolCount !== undefined ? <span>{connector.toolCount} tools</span> : null}
          </div>
        </div>
        {auth === "oauth" ? <OAuthConnect name={name} connected={connected} /> : null}
      </div>

      {auth === "none" ? <p className="field__hint">No setup needed.</p> : null}

      {auth === "api_key" ? (
        <div className="connector__creds">
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
      <div className="row">
        <span className="row__main field__label">{credKey}</span>
        <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
          Update
        </button>
      </div>
    );
  }

  return (
    <div className="field">
      <span className="field__label">{credKey}</span>
      <div className="chat__input">
        <input
          type="password"
          value={value}
          placeholder={`Paste ${credKey}`}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <button type="button" onClick={save} disabled={saving || !value}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {err ? <p className="field__hint state--error">{err}</p> : null}
    </div>
  );
}

function OAuthConnect({ name, connected }: { name: string; connected: boolean }) {
  // Full-page navigation (not fetch) so the gateway → Atlassian redirect chain works in the browser.
  const connect = () => {
    window.location.href = `${API_BASE}/connectors/${name}/connect`;
  };
  return (
    <div className="row__actions">
      <button
        type="button"
        className={`btn btn--sm${connected ? "" : " btn--primary"}`}
        onClick={connect}
      >
        {connected ? "Reconnect" : "Connect"}
      </button>
    </div>
  );
}
