"use client";

import { Cable, Search, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type ComposioToolkit,
  type ConnectionFeedback,
  parseConnectionFeedback,
  parseToolkitPage,
  toolkitSearchUrl,
} from "./connectors-helpers";

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
  const [activeTab, setActiveTab] = useState<"custom" | "composio">("custom");
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customQuery, setCustomQuery] = useState("");
  const [toolkits, setToolkits] = useState<ComposioToolkit[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [toolkitError, setToolkitError] = useState<string | null>(null);
  const [toolkitLoading, setToolkitLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [feedback, setFeedback] = useState<ConnectionFeedback | null>(null);
  const toolkitRequest = useRef(0);

  const loadCustom = useCallback(() => {
    setCustomError(null);
    fetch(`${API_BASE}/connectors`)
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json() as Promise<{ connectors: Connector[] }>;
      })
      .then((data) => setConnectors(data.connectors))
      .catch(() => setCustomError("Failed to load custom tools"));
  }, []);

  const loadToolkits = useCallback(async (search: string, cursor?: string) => {
    const request = ++toolkitRequest.current;
    setToolkitLoading(true);
    setToolkitError(null);
    try {
      const response = await fetch(toolkitSearchUrl(API_BASE, search, cursor));
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const page = parseToolkitPage(await response.json());
      if (request !== toolkitRequest.current) return;
      setConfigured(page.configured);
      setToolkits((current) => (cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
      if (!cursor) setActiveQuery(search);
    } catch {
      if (request !== toolkitRequest.current) return;
      setToolkitError("Failed to load Composio toolkits");
    } finally {
      if (request === toolkitRequest.current) setToolkitLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustom();
    void loadToolkits("");
    const searchParams = new URLSearchParams(window.location.search);
    setFeedback(parseConnectionFeedback(window.location.search));
    if (searchParams.get("tab") === "composio") setActiveTab("composio");
  }, [loadCustom, loadToolkits]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    void loadToolkits(nextQuery);
  }

  const filteredConnectors = connectors?.filter((connector) =>
    `${connector.name} ${connector.kind} ${connector.auth}`
      .toLowerCase()
      .includes(customQuery.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b pb-5">
        <h1 className="text-xl font-semibold tracking-tight">Tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse and connect the integrations available to your agents.
        </p>
      </div>

      {feedback ? (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={
            feedback.kind === "error"
              ? "text-sm text-destructive"
              : "text-sm text-green-700 dark:text-green-400"
          }
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Tool source" className="inline-flex w-fit rounded-lg bg-muted p-1">
            <ToolTab active={activeTab === "custom"} onClick={() => setActiveTab("custom")}>
              Custom
            </ToolTab>
            <ToolTab active={activeTab === "composio"} onClick={() => setActiveTab("composio")}>
              Composio
            </ToolTab>
          </nav>

          {activeTab === "custom" ? (
            <SearchField
              id="custom-tool-search"
              value={customQuery}
              placeholder="Search custom tools"
              onChange={setCustomQuery}
            />
          ) : (
            <form onSubmit={search} className="w-full sm:max-w-xs">
              <SearchField
                id="toolkit-search"
                value={query}
                placeholder="Search Composio tools"
                disabled={configured === false}
                onChange={setQuery}
              />
              <button
                type="submit"
                className="sr-only"
                disabled={configured === false || toolkitLoading}
              >
                Search
              </button>
            </form>
          )}
        </div>

        {activeTab === "custom" ? (
          <section aria-label="Custom tools">
            {customError ? (
              <CatalogError message={customError} onRetry={loadCustom} />
            ) : connectors === null ? (
              <CatalogMessage>Loading custom tools…</CatalogMessage>
            ) : filteredConnectors?.length === 0 ? (
              <CatalogMessage>
                {customQuery ? "No custom tools match your search." : "No custom tools configured."}
              </CatalogMessage>
            ) : (
              <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredConnectors?.map((connector) => (
                  <ConnectorCard key={connector.name} connector={connector} onChange={loadCustom} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section aria-label="Composio tools" className="grid gap-4">
            {toolkitError ? (
              <CatalogError message={toolkitError} onRetry={() => loadToolkits(activeQuery)} />
            ) : null}
            {!configured && configured !== null ? (
              <CatalogMessage>
                Composio is not configured. Set the optional <code>COMPOSIO_API_KEY</code> in the
                gateway environment to browse its tools.
              </CatalogMessage>
            ) : toolkitLoading && toolkits.length === 0 ? (
              <CatalogMessage>Loading Composio tools…</CatalogMessage>
            ) : toolkits.length === 0 ? (
              toolkitError ? null : (
                <CatalogMessage>No Composio tools found.</CatalogMessage>
              )
            ) : (
              <>
                <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {toolkits.map((toolkit) => (
                    <ToolkitCard key={toolkit.slug} toolkit={toolkit} />
                  ))}
                </ul>
                {nextCursor ? (
                  <Button
                    className="justify-self-center rounded-xl"
                    variant="outline"
                    disabled={toolkitLoading}
                    onClick={() => loadToolkits(activeQuery, nextCursor)}
                  >
                    {toolkitLoading ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ToolTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SearchField({
  id,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Label htmlFor={id} className="sr-only">
        {placeholder}
      </Label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        className="h-9 rounded-xl pl-9"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function CatalogMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3"
    >
      <p className="text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function ConnectorCard({ connector, onChange }: { connector: Connector; onChange: () => void }) {
  const { name, auth, connected } = connector;
  const toolCount = connector.toolCount ?? 0;
  const [credentialModalOpen, setCredentialModalOpen] = useState(false);
  return (
    <li className="group flex min-h-40 min-w-0 flex-col rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/10">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          <Cable className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium capitalize">{name}</p>
            {connected ? <ConnectionStatus connected /> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {toolCount > 0 ? `${toolCount} ${toolCount === 1 ? "tool" : "tools"}` : "Custom tools"}
            {` available through ${connector.kind === "mcp" ? "MCP" : "the Gilly gateway"}.`}
          </p>
        </div>
      </div>

      <div className="mt-auto flex min-w-0 items-end justify-between gap-3 pt-4">
        <span className="text-xs capitalize text-muted-foreground">
          {auth === "none" ? "No setup needed" : auth.replace("_", " ")}
        </span>
        {auth === "oauth" ? <OAuthConnect name={name} connected={connected} /> : null}
        {auth === "api_key" ? (
          <Button
            className="rounded-xl"
            variant="outline"
            size="sm"
            onClick={() => setCredentialModalOpen(true)}
          >
            {connected ? "Update" : "Connect"}
          </Button>
        ) : null}
      </div>
      {credentialModalOpen ? (
        <CredentialModal
          connector={connector}
          onClose={() => setCredentialModalOpen(false)}
          onSaved={onChange}
        />
      ) : null}
    </li>
  );
}

function ToolkitCard({ toolkit }: { toolkit: ComposioToolkit }) {
  const connect = () => {
    window.location.assign(
      `${API_BASE}/composio/toolkits/${encodeURIComponent(toolkit.slug)}/connect`,
    );
  };

  return (
    <li className="group flex min-h-40 min-w-0 flex-col rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/10">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/50">
          {toolkit.logo ? (
            <Image
              src={toolkit.logo}
              alt=""
              width={28}
              height={28}
              className="size-7 object-contain"
              unoptimized
            />
          ) : (
            <Cable className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{toolkit.name}</p>
            {toolkit.noAuth ? (
              <ConnectionStatus connected label="Ready" />
            ) : toolkit.connected ? (
              <ConnectionStatus connected />
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {toolkit.description || `${toolkit.name} tools through Composio.`}
          </p>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <span className="text-xs text-muted-foreground">
          {toolkit.toolsCount} {toolkit.toolsCount === 1 ? "tool" : "tools"}
        </span>
        {!toolkit.noAuth ? (
          <Button className="rounded-xl" variant="outline" size="sm" onClick={connect}>
            {toolkit.connected ? "Reconnect" : "Connect"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ConnectionStatus({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        connected
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {label ?? (connected ? "Connected" : "Not connected")}
    </span>
  );
}

function CredentialModal({
  connector,
  onClose,
  onSaved,
}: {
  connector: Connector;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  async function save() {
    const credentials = connector.requiredCreds.filter((key) => values[key]?.trim());
    if (!connector.connected && credentials.length !== connector.requiredCreds.length) {
      setError("Enter all required credentials.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/connectors/${encodeURIComponent(connector.name)}/credentials`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            credentials: Object.fromEntries(
              credentials.map((key) => [key, values[key]?.trim() ?? ""]),
            ),
          }),
        },
      );
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`credential-title-${connector.name}`}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/35"
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else onClose();
      }}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={`credential-title-${connector.name}`}
              className="text-lg font-semibold capitalize"
            >
              {connector.connected ? "Update" : "Connect"} {connector.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {connector.connected
                ? "Enter only the credentials you want to replace."
                : "Enter the credentials required by this integration."}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close"
            disabled={saving}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        <div className="mt-6 grid gap-4">
          {connector.requiredCreds.map((key, index) => (
            <div key={key} className="grid gap-2">
              <Label htmlFor={`cred-${connector.name}-${key}`}>{key}</Label>
              <Input
                id={`cred-${connector.name}-${key}`}
                type="password"
                value={values[key] ?? ""}
                placeholder={`Paste ${key}`}
                autoComplete="off"
                autoFocus={index === 0}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !connector.requiredCreds.some((key) => values[key]?.trim())}
          >
            {saving ? "Saving…" : "Save credentials"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function OAuthConnect({ name, connected }: { name: string; connected: boolean }) {
  const connect = () => {
    window.location.assign(`${API_BASE}/connectors/${encodeURIComponent(name)}/connect`);
  };
  return (
    <Button className="rounded-xl" variant="outline" size="sm" onClick={connect}>
      {connected ? "Reconnect" : "Connect"}
    </Button>
  );
}
