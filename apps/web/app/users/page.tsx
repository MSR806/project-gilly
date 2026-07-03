"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type User = { id: string; slackUserId: string; name: string; isAdmin: boolean };
type Grant = { id: string; userId: string; toolPattern: string };

export default function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/users`)
      .then((r) => r.json() as Promise<User[]>)
      .then(setUsers)
      .catch(() => setError("Failed to load users"));
    fetch(`${API_BASE}/connectors`)
      .then((r) => r.json() as Promise<{ connectors: { name: string }[] }>)
      .then((d) => setConnectors((d.connectors ?? []).map((c) => c.name)))
      .catch(() => setConnectors([]));
  }, []);

  return (
    <section className="section">
      <div className="section__head">
        <h1 className="page-title">Users &amp; Grants</h1>
      </div>

      {error ? <p className="state state--error">{error}</p> : null}

      {users === null ? (
        <p className="state">Loading users…</p>
      ) : users.length === 0 ? (
        <p className="state">
          No users yet — a user appears here the first time they message the bot in Slack.
        </p>
      ) : (
        <ul className="card-list">
          {users.map((u) => (
            <UserCard key={u.id} user={u} connectors={connectors} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UserCard({ user, connectors }: { user: User; connectors: string[] }) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [connector, setConnector] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/users/${user.id}/grants`)
      .then((r) => r.json() as Promise<Grant[]>)
      .then(setGrants)
      .catch(() => setErr("Failed to load grants"));
  }, [user.id]);

  useEffect(load, [load]);

  async function add() {
    const name = connector || connectors[0];
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, toolPattern: `${name}.*` }),
      });
      if (!res.ok) throw new Error(`grant failed (${res.status})`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "grant failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/grants/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`remove failed (${res.status})`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "remove failed");
    }
  }

  return (
    <li className="card">
      <div className="row">
        <div className="row__main">
          <p className="card__name">
            {user.name}
            {user.isAdmin ? <span className="badge badge--ok">admin</span> : null}
          </p>
          <div className="card__meta">
            <span>slack: {user.slackUserId}</span>
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field__label">Grants</span>
        {grants === null ? (
          <p className="field__hint">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="field__hint">No access — this user's tool catalog is empty.</p>
        ) : (
          <span className="ms__chips">
            {grants.map((g) => (
              <button
                key={g.id}
                type="button"
                className="ms__chip"
                title="Remove grant"
                onClick={() => remove(g.id)}
              >
                {g.toolPattern} ×
              </button>
            ))}
          </span>
        )}
      </div>

      {connectors.length > 0 ? (
        <div className="row">
          <select
            className="row__main"
            value={connector || connectors[0]}
            onChange={(e) => setConnector(e.target.value)}
          >
            {connectors.map((name) => (
              <option key={name} value={name}>
                {name}.*
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--sm btn--primary" onClick={add} disabled={busy}>
            {busy ? "Granting…" : "Grant"}
          </button>
        </div>
      ) : null}

      {err ? <p className="field__hint state--error">{err}</p> : null}
    </li>
  );
}
