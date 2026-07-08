"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

/** Slack app/display name → lowercase, hyphenated (Slack rejects spaces/punctuation). */
const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Socket Mode → no public URL, so the manifest is static except the bot name (mirrors
// docs/slack-app-manifest.yaml). The name lands in both display_information and bot_user.
const buildManifest = (botName: string) => `display_information:
  name: ${botName}
  description: Always working cloud agent
  background_color: "#000d63"
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: false
    messages_tab_read_only_enabled: true
  bot_user:
    display_name: ${botName}
    always_online: true
oauth_config:
  scopes:
    bot:
      - chat:write
      - app_mentions:read
      - reactions:write
      - channels:history
      - channels:read
      - groups:history
      - groups:read
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
`;

export type ConnectionValues = {
  name: string;
  agentId: string;
  botToken: string;
  appToken: string;
};

type Agent = { id: string; name: string };

const CREATE_STEPS = ["Name", "Create app", "Tokens", "Agent"];

export default function ConnectionForm({
  mode,
  id,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  /** Connection id (edit mode). */
  id?: string;
  initial?: Partial<ConnectionValues>;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Create-wizard state. `suffix` → botName `gilly-<suffix>` (also the connection name).
  const [step, setStep] = useState(0);
  const [suffix, setSuffix] = useState("");
  const botName = suffix ? `gilly-${slugify(suffix)}` : "";

  // Shared token/agent state (create + edit).
  const [name, setName] = useState(initial?.name ?? "");
  const [agentId, setAgentId] = useState(initial?.agentId ?? "");
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/agents`)
      .then((r) => r.json() as Promise<Agent[]>)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  async function copyManifest() {
    await navigator.clipboard.writeText(buildManifest(botName || "gilly-bot"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/slack/connections/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botToken }),
      });
      const body = (await res.json()) as { ok?: boolean; team?: string; error?: string };
      if (res.ok && body.ok) setTestResult(`Connected to ${body.team || "workspace"} ✓`);
      else setError(body.error ?? "Connection test failed");
    } catch {
      setError("Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  async function submit() {
    setError(null);
    setSaving(true);
    // On edit, only send tokens the user re-entered (blank = keep existing).
    const payload =
      mode === "create"
        ? { name: botName, agentId, botToken, appToken }
        : {
            name,
            agentId,
            ...(botToken ? { botToken } : {}),
            ...(appToken ? { appToken } : {}),
          };
    const url =
      mode === "create" ? `${API_BASE}/slack/connections` : `${API_BASE}/slack/connections/${id}`;
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
      if (onSaved) onSaved();
      else router.push("/connections");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  const agentSelect = (
    <div className="grid gap-2">
      <Label>Agent</Label>
      <Select value={agentId || null} onValueChange={(v) => setAgentId(v ?? "")}>
        <SelectTrigger className="w-full">
          <SelectValue>
            {(val) => agents.find((a) => a.id === val)?.name ?? "Select an agent"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Every message on this channel runs this agent.
      </p>
    </div>
  );

  // --- Edit: a flat form (the Slack app already exists; just rename / rebind / rotate) ---
  if (mode === "edit") {
    return (
      <div className="flex max-w-2xl flex-col gap-5">
        <div className="grid gap-2">
          <Label htmlFor="conn-name">Name</Label>
          <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {agentSelect}
        <div className="grid gap-2">
          <Label htmlFor="conn-bot">Bot token</Label>
          <Input
            id="conn-bot"
            type="password"
            value={botToken}
            placeholder="Leave blank to keep current"
            autoComplete="off"
            onChange={(e) => setBotToken(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="conn-app">App token</Label>
          <Input
            id="conn-app"
            type="password"
            value={appToken}
            placeholder="Leave blank to keep current"
            autoComplete="off"
            onChange={(e) => setAppToken(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={testing || !botToken}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testResult ? (
            <span className="text-sm text-green-700 dark:text-green-400">{testResult}</span>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={saving || !name || !agentId}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => (onCancel ? onCancel() : router.push("/connections"))}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // --- Create: a next/next wizard ---
  const canAdvance = step === 0 ? botName.length > 6 : step === 2 ? !!botToken && !!appToken : true;
  const last = step === CREATE_STEPS.length - 1;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {/* Stepper header */}
      <ol className="flex items-center gap-2 text-xs">
        {CREATE_STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex size-5 items-center justify-center rounded-full text-[11px] ${
                i < step
                  ? "bg-primary text-primary-foreground"
                  : i === step
                    ? "border border-primary text-primary"
                    : "border text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={i === step ? "font-medium" : "text-muted-foreground"}>{label}</span>
            {i < CREATE_STEPS.length - 1 ? <span className="text-muted-foreground">→</span> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="grid gap-2">
          <Label htmlFor="conn-suffix">Bot name</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">gilly-</span>
            <Input
              id="conn-suffix"
              value={suffix}
              autoFocus
              placeholder="acme"
              onChange={(e) => setSuffix(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Your bot will be named <code>{botName || "gilly-…"}</code> in Slack and in this list.
          </p>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Open{" "}
              <a
                href="https://api.slack.com/apps?new_app=1"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                api.slack.com/apps
              </a>{" "}
              → <strong>Create New App</strong> → <strong>From a manifest</strong>.
            </li>
            <li>
              Pick your workspace, paste the manifest below (bot named <code>{botName}</code>), and
              create the app.
            </li>
            <li>
              <strong>Install to Workspace</strong> — you'll grab the tokens on the next step.
            </li>
          </ol>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={copyManifest}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy manifest"}
            </Button>
          </div>
          <pre className="max-h-56 overflow-auto rounded-lg border bg-background p-3 text-xs">
            {buildManifest(botName)}
          </pre>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="conn-bot">Bot token</Label>
            <Input
              id="conn-bot"
              type="password"
              value={botToken}
              placeholder="xoxb-…"
              autoComplete="off"
              onChange={(e) => setBotToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <em>OAuth &amp; Permissions</em> → Bot User OAuth Token.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="conn-app">App token</Label>
            <Input
              id="conn-app"
              type="password"
              value={appToken}
              placeholder="xapp-…"
              autoComplete="off"
              onChange={(e) => setAppToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <em>Basic Information → App-Level Tokens</em>, scope <code>connections:write</code>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={testConnection}
              disabled={testing || !botToken}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {testResult ? (
              <span className="text-sm text-green-700 dark:text-green-400">{testResult}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 3 ? agentSelect : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        {step > 0 ? (
          <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => (onCancel ? onCancel() : router.push("/connections"))}
          >
            Cancel
          </Button>
        )}
        {last ? (
          <Button type="button" onClick={submit} disabled={saving || !agentId}>
            {saving ? "Saving…" : "Create channel"}
          </Button>
        ) : (
          <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
