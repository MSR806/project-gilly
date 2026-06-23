"use client";

import { useEffect, useRef, useState } from "react";

export type Option = { value: string; description?: string };
export type Group = { label: string; options: Option[] };

/**
 * Dependency-free grouped multi-select: selected values render as removable chips above a
 * toggle-open panel of grouped, checkable options with descriptions. Closes on outside-click/Escape.
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="ms" ref={ref}>
      <div className="ms__control">
        {selected.map((value) => (
          <span key={value} className="ms__chip">
            {value}
            <button
              type="button"
              className="ms__chip-x"
              aria-label={`Remove ${value}`}
              onClick={() => toggle(value)}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="ms__toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {selected.length === 0 ? <span className="ms__placeholder">{placeholder}</span> : null}
          <span className="ms__caret">▾</span>
        </button>
      </div>

      {open ? (
        <div className="ms__panel">
          {groups.map((group) => (
            <div key={group.label} className="ms__group">
              {group.label ? <p className="ms__group-label">{group.label}</p> : null}
              {group.options.map((option) => (
                <label key={option.value} className="ms__option">
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={() => toggle(option.value)}
                  />
                  <span>
                    <span className="ms__option-value">{option.value}</span>
                    {option.description ? (
                      <span className="ms__desc"> — {option.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
