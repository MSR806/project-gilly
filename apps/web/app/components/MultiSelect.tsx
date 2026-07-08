"use client";

import { ChevronDown, X } from "lucide-react";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type Option = { value: string; description?: string };
export type Group = { label: string; options: Option[] };

/**
 * Grouped multi-select: selected values render as removable chips in front of a dropdown of
 * grouped, checkable options with descriptions.
 */
export default function MultiSelect({
  groups,
  selected,
  onChange,
  placeholder = "Select…",
}: {
  groups: Group[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-colors focus-within:border-ring hover:border-ring">
      {selected.map((value) => (
        <Badge key={value} variant="secondary" className="gap-1 pr-1">
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            className="rounded-sm text-muted-foreground hover:text-destructive"
            onClick={() => toggle(value)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-15 flex-1 items-center justify-between gap-2 text-left text-sm">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span />
          )}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-60" align="start">
          {groups.map((group, i) => (
            <Fragment key={group.label}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
                {group.options.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={selected.includes(option.value)}
                    onCheckedChange={() => toggle(option.value)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span>
                      <code className="font-mono text-xs">{option.value}</code>
                      {option.description ? (
                        <span className="text-muted-foreground"> — {option.description}</span>
                      ) : null}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
