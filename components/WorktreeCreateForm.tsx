"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * A worktree menu's "New worktree…" body (components/ProjectWorktreePicker.tsx,
 * in the files tab and the bar above a fresh composer): a branch name and
 * Create. On a phone the sheet brings its own Cancel and title; in the files
 * tab's classic menu it shows under the list, as on main.
 */
export function WorktreeCreateForm({
  heading,
  busy,
  error,
  showCancel,
  onCreate,
  onCancel,
}: {
  heading: string | null;
  busy: boolean;
  error: string | null;
  showCancel: boolean;
  onCreate: (branch: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [branch, setBranch] = useState("");
  const trimmed = branch.trim();
  const submit = () => {
    if (trimmed && !busy) onCreate(trimmed);
  };
  return (
    <div className="sidebar-worktree-form">
      {heading && <div className="sidebar-menu-header">{heading}</div>}
      <input
        className="sidebar-worktree-input"
        data-sidebar-menu-autofocus=""
        value={branch}
        readOnly={busy}
        placeholder={t("sidebar.branchName")}
        aria-label={t("sidebar.branchName")}
        onChange={(event) => setBranch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          submit();
        }}
      />
      <div className="sidebar-worktree-form-buttons">
        <button type="button" className="sidebar-worktree-create" disabled={busy || !trimmed} onClick={submit}>
          {busy ? t("sidebar.creating") : t("sidebar.create")}
        </button>
        {showCancel && (
          <button type="button" className="sidebar-worktree-cancel" onClick={onCancel}>
            {t("sidebar.cancel")}
          </button>
        )}
      </div>
      {error && <div className="sidebar-worktree-error" role="alert">{error}</div>}
    </div>
  );
}
