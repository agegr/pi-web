"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Initial value seeded into the input. */
  initialValue: string;
  /**
   * When true (rename), select the name without its extension - mirrors
   * JupyterLab's `lastIndexOf('.')` selection trick. When false (new
   * file/folder), select the whole name so typing replaces the placeholder.
   */
  selectNameWithoutExtension?: boolean;
  /** Called with the current value on Enter or blur. */
  onCommit: (name: string) => void;
  /** Called on Escape. */
  onCancel: () => void;
  /** Render with an error outline (e.g. a server-side validation failure). */
  invalid?: boolean;
}

/**
 * An inline filename editor used for rename and new-file/new-folder flows.
 * Commits on Enter or blur, cancels on Escape. A ref guards against the
 * blur that follows Enter firing a second commit.
 */
export function InlineFileNameInput({
  initialValue,
  selectNameWithoutExtension = true,
  onCommit,
  onCancel,
  invalid = false,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (selectNameWithoutExtension) {
      const dot = initialValue.lastIndexOf(".");
      // Dotfiles (".gitignore") or no extension: select everything.
      if (dot <= 0) {
        input.select();
      } else {
        input.setSelectionRange(0, dot);
      }
    } else {
      input.select();
    }
  }, [initialValue, selectNameWithoutExtension]);

  const settle = (fn: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    fn();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => settle(() => onCommit(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          settle(() => onCommit(value));
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          settle(() => onCancel());
        }
      }}
      style={{
        flex: 1,
        minWidth: 0,
        height: 20,
        fontSize: 12,
        color: "var(--text)",
        background: invalid ? "color-mix(in srgb, #ef4444 12%, var(--bg))" : "var(--bg)",
        border: `1px solid ${invalid ? "#ef4444" : "var(--accent)"}`,
        borderRadius: 4,
        padding: "0 4px",
        outline: "none",
        fontFamily: "var(--font-mono)",
      }}
    />
  );
}
