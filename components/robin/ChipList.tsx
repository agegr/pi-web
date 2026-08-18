"use client";

import { useState } from "react";

/**
 * A keyword list edited as removable chips.
 *
 * Chips rather than a textarea because the list is read far more often than it
 * is written: you glance at "what am I actually searching for" every time you
 * open this, and a wrapped block of thirty lines answers that worse than
 * thirty labelled chips do. Bulk entry survives — the input splits on commas
 * and newlines, so a pasted list still lands as chips.
 */
export function ChipList({
  values,
  onChange,
  placeholder,
  label,
  tone = "accent",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  label: string;
  /** `accent` for things you want, `muted` for things you exclude. */
  tone?: "accent" | "muted";
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const entries = raw.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
    if (entries.length === 0) return;
    const seen = new Set(values.map((value) => value.toLowerCase()));
    const fresh = entries.filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length > 0) onChange([...values, ...fresh]);
    setDraft("");
  };

  const chipStyle = tone === "accent"
    ? { background: "var(--accent-subtle)", borderColor: "var(--accent-line)", color: "var(--text)" }
    : { background: "var(--bg-subtle)", borderColor: "var(--border)", color: "var(--text-muted)" };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1.5 px-2 py-1 text-xs"
            style={{ border: "1px solid", ...chipStyle }}
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((entry) => entry !== value))}
              aria-label={`Remove ${value}`}
              className="ui-action leading-none"
              data-hover="danger"
              style={{ fontSize: 13 }}
            >
              ×
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>—</span>
        )}
      </div>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          }
          // Backspace on an empty field removes the last chip, the way every
          // token field behaves — otherwise a typo means reaching for the mouse.
          if (event.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
        aria-label={label}
        className="rounded px-2 py-1 text-sm outline-none"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
      />
    </div>
  );
}
