"use client";

import { Cable, Check, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type GatewayTool,
  type GatewayToolkit,
  gatewayToolkits,
  toggleGatewayToolkit,
} from "./agent-form-helpers";

export default function GatewayToolkitPicker({
  tools,
  selected,
  onChange,
}: {
  tools: readonly GatewayTool[];
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const toolkits = gatewayToolkits(tools);
  const available = new Set(tools.map((tool) => tool.name));
  const unavailable = [...new Set(selected)].filter((tool) => !available.has(tool));
  const selectedSet = new Set(selected);
  const selectedToolkitCount = toolkits.filter((toolkit) =>
    toolkit.tools.some((tool) => selectedSet.has(tool.name)),
  ).length;
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<GatewayTool["source"]>("custom");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(selected);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  function openPicker() {
    setDraft(selected);
    setQuery("");
    setSource(toolkits.some((toolkit) => toolkit.source === "custom") ? "custom" : "composio");
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
  }

  function apply() {
    onChange(draft);
    closePicker();
  }

  const draftSet = new Set(draft);
  const sourceToolkits = toolkits.filter((toolkit) => toolkit.source === source);
  const filtered = sourceToolkits.filter((toolkit) => {
    const search = query.trim().toLowerCase();
    return (
      !search ||
      toolkit.toolkit.toLowerCase().includes(search) ||
      toolkit.tools.some(
        (tool) =>
          tool.name.toLowerCase().includes(search) ||
          tool.description.toLowerCase().includes(search),
      )
    );
  });
  const draftUnavailable = [...new Set(draft)].filter((tool) => !available.has(tool));

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/15 p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {selected.length
              ? `${selectedToolkitCount} ${selectedToolkitCount === 1 ? "integration" : "integrations"} · ${selected.length} ${selected.length === 1 ? "tool" : "tools"}`
              : "No external integrations selected"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Toolkit choices are saved as an exact tool allowlist.
            {unavailable.length ? ` ${unavailable.length} unavailable tools are preserved.` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={openPicker}>
          Choose integrations
        </Button>
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="gateway-toolkit-picker-title"
        className="m-auto w-[calc(100%-1.5rem)] max-w-3xl rounded-2xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/35"
        onCancel={(event) => {
          event.preventDefault();
          closePicker();
        }}
        onClose={() => setOpen(false)}
      >
        <div className="flex max-h-[min(85vh,760px)] min-h-[min(70vh,620px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
            <div>
              <h2 id="gateway-toolkit-picker-title" className="text-lg font-semibold">
                Choose integrations
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Selecting an integration grants its currently available tools.
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Close"
              onClick={closePicker}
            >
              <X />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <nav
                aria-label="Integration source"
                className="inline-flex w-fit rounded-lg bg-muted p-1"
              >
                <SourceButton active={source === "custom"} onClick={() => setSource("custom")}>
                  Custom
                </SourceButton>
                <SourceButton active={source === "composio"} onClick={() => setSource("composio")}>
                  Composio
                </SourceButton>
              </nav>
              <div className="relative w-full sm:max-w-xs">
                <Label htmlFor="gateway-toolkit-search" className="sr-only">
                  Search integrations
                </Label>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="gateway-toolkit-search"
                  type="search"
                  value={query}
                  placeholder="Search integrations"
                  className="h-9 rounded-xl pl-9"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            {filtered.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filtered.map((toolkit) => (
                  <ToolkitOption
                    key={toolkit.id}
                    toolkit={toolkit}
                    selected={draftSet}
                    onToggle={() =>
                      setDraft((current) =>
                        toggleGatewayToolkit(
                          current,
                          toolkit.tools.map((tool) => tool.name),
                        ),
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed bg-muted/15 px-4 py-12 text-center text-sm text-muted-foreground">
                {sourceToolkits.length
                  ? "No integrations match your search."
                  : source === "custom"
                    ? "No custom integrations available."
                    : "No connected Composio integrations. "}
                {!sourceToolkits.length && source === "composio" ? (
                  <a href="/connectors" className="underline underline-offset-4">
                    Connect one on the Tools page.
                  </a>
                ) : null}
              </p>
            )}

            {draftUnavailable.length ? (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center dark:border-amber-900 dark:bg-amber-950/30">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {draftUnavailable.length} unavailable legacy{" "}
                    {draftUnavailable.length === 1 ? "tool" : "tools"}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
                    Preserved so editing another field does not silently remove access.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft((current) =>
                      current.filter((tool) => !draftUnavailable.includes(tool)),
                    )
                  }
                >
                  Remove unavailable
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-3 border-t bg-background px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-sm text-muted-foreground">
              {draft.length} {draft.length === 1 ? "tool" : "tools"} selected
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closePicker}>
                Cancel
              </Button>
              <Button type="button" onClick={apply}>
                Apply selection
              </Button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

function SourceButton({
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

function ToolkitOption({
  toolkit,
  selected,
  onToggle,
}: {
  toolkit: GatewayToolkit;
  selected: ReadonlySet<string>;
  onToggle: () => void;
}) {
  const selectedCount = toolkit.tools.filter((tool) => selected.has(tool.name)).length;
  const allSelected = selectedCount === toolkit.tools.length;
  const partial = selectedCount > 0 && !allSelected;
  const label = humanize(toolkit.toolkit);
  const toolNoun = toolkit.tools.length === 1 ? "tool" : "tools";

  return (
    <button
      type="button"
      aria-pressed={partial ? "mixed" : allSelected}
      aria-label={
        allSelected
          ? `Clear ${label}, all ${toolkit.tools.length} ${toolNoun} selected`
          : partial
            ? `Select all ${label}, ${selectedCount} of ${toolkit.tools.length} ${toolNoun} currently selected`
            : `Select ${label}, ${toolkit.tools.length} ${toolNoun}`
      }
      className={`flex min-h-36 min-w-0 flex-col rounded-2xl border p-4 text-left transition-colors ${
        selectedCount
          ? "border-foreground/30 bg-muted/30"
          : "bg-card hover:border-foreground/20 hover:bg-muted/10"
      }`}
      onClick={onToggle}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
            toolkit.source === "composio"
              ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
              : "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
          }`}
        >
          <Cable className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{label}</span>
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                selectedCount
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background"
              }`}
            >
              {allSelected ? (
                <Check className="size-3.5" />
              ) : partial ? (
                <span className="size-2 rounded-full bg-current" />
              ) : null}
            </span>
          </span>
          <span className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {toolkit.tools.length} exact {toolkit.tools.length === 1 ? "tool" : "tools"} available
            through {toolkit.source === "composio" ? "Composio" : "the gateway"}.
          </span>
        </span>
      </span>
      <span className="mt-auto flex items-end justify-between gap-3 pt-4 text-xs">
        <span
          className={
            toolkit.connected
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-amber-700 dark:text-amber-300"
          }
        >
          {toolkit.connected ? "Connected" : "Not connected"}
        </span>
        {partial ? (
          <span className="text-muted-foreground">Partial · {selectedCount} selected</span>
        ) : null}
      </span>
    </button>
  );
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
