"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
    <section>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Users &amp; Grants</h1>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {users === null ? (
        <p className="py-6 text-sm text-muted-foreground">Loading users…</p>
      ) : users.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No users yet — a user appears here the first time they message the bot in Slack.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Slack</TableHead>
                <TableHead>Grants</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} connectors={connectors} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function UserRow({ user, connectors }: { user: User; connectors: string[] }) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/users/${user.id}/grants`)
      .then((r) => r.json() as Promise<Grant[]>)
      .then(setGrants)
      .catch(() => setErr("Failed to load grants"));
  }, [user.id]);

  useEffect(load, [load]);

  async function add(connector: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/grants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, toolPattern: `${connector}.*` }),
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

  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </div>
          <span className="font-medium">{user.name}</span>
          {user.isAdmin ? <Badge variant="outline">admin</Badge> : null}
        </div>
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs text-muted-foreground">{user.slackUserId}</code>
      </TableCell>
      <TableCell>
        {grants === null ? (
          <span className="text-xs text-muted-foreground">Loading…</span>
        ) : grants.length === 0 ? (
          <span className="text-xs text-muted-foreground">No access</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {grants.map((g) => (
              <Badge key={g.id} variant="secondary" className="gap-1 pr-1">
                {g.toolPattern}
                <button
                  type="button"
                  title="Remove grant"
                  className="rounded-sm text-muted-foreground hover:text-destructive"
                  onClick={() => remove(g.id)}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </span>
        )}
        {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
      </TableCell>
      <TableCell>
        {connectors.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={busy} />}>
              <Plus /> Grant
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {connectors.map((name) => (
                <DropdownMenuItem key={name} onClick={() => add(name)}>
                  {name}.*
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
