"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { PinOutcome } from "@/lib/custom-directory-pin";
import {
  createBrowseController,
  createShowHiddenLifecycle,
  runCreateSubmission,
  type BrowseController,
  type BrowseDirectoryEntry,
  type BrowseResult,
} from "@/lib/directory-picker-browse";

/** One sidebar-list entry as the picker's manage panel needs it. */
export interface PickerManagedEntry {
  path: string;
  displayName?: string;
}

/**
 * Outcome contract of the manage-mode row actions (wi pi#52): silent
 * success, or a typed failure whose message (already locale-resolved by the
 * store owner) the picker surfaces in-dialog — under the path editor for a
 * rename refusal, in the error area for a delete refusal.
 */
export type ManageOutcome = { ok: true } | { ok: false; error: string };

type Translate = (key: string) => string;

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M1.5 3h4l1.5 2h7.5v7.5h-13z" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 9h12" />
      <circle cx="11.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M4 1.5h5.5L13 5v9.5H4z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  );
}

/** Pushpin glyph for the per-row pin (固定) affordance. */
function PinGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M3.6 1h2.8l-.4 2.6 1.5 1.4v.8H2.5v-.8L4 3.6z" />
      <line x1="5" y1="5.8" x2="5" y2="9" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <line x1="5" y1="1" x2="5" y2="9" />
      <line x1="1" y1="5" x2="9" y2="5" />
    </svg>
  );
}

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

/**
 * Pin-row controller: awaits the store owner's callback and surfaces a
 * typed error in-dialog on failure. Success is silent by contract — the
 * callback is the ONLY thing invoked, so a pin can never navigate, refetch
 * or close the picker; the dialog stays on the same browsed directory with
 * the same listing. Plain function (injectable callbacks) so tests drive
 * the real logic without a DOM.
 */
export function createRowPinHandler(options: {
  onPin: (path: string) => Promise<PinOutcome>;
  onError: (message: string) => void;
}): (path: string) => Promise<void> {
  return async (path: string) => {
    try {
      const outcome = await options.onPin(path);
      if (!outcome.ok) options.onError(outcome.error);
    } catch (cause) {
      options.onError(cause instanceof Error ? cause.message : String(cause));
    }
  };
}

/**
 * Error-lifecycle seam (review P2): the picker's browse, pin and manage
 * errors are managed by ONE production-used helper so stale errors can
 * never mask a fresh failure —
 *
 * - every new browse request resets ALL stale errors (a fresh navigation
 *   invalidates the previous action's context),
 * - a successful browse clears the browse error,
 * - every new pin attempt resets the previous pin error first,
 * - every new manage attempt (delete / path rename, wi pi#52) resets the
 *   previous manage error first,
 * - and a genuine pin/manage failure ALWAYS wins the render precedence
 *   over a leftover browse error (see pickerErrorMessage).
 */
export function createPickerErrorState(setters: {
  setLoadError: (message: string | null) => void;
  setPinError: (message: string | null) => void;
  setManageError: (message: string | null) => void;
}) {
  return {
    onBrowseStart: () => {
      setters.setLoadError(null);
      setters.setPinError(null);
      setters.setManageError(null);
    },
    onBrowseSuccess: () => setters.setLoadError(null),
    onBrowseError: (message: string) => setters.setLoadError(message),
    onPinStart: () => {
      // A new pin attempt supersedes ALL stale action errors (manage
      // refusal, browse failure): otherwise pickerErrorMessage's
      // precedence keeps showing an old message and masks the pin
      // attempt's own failure — or lingers after its success (review r1
      // B2, wi pi#51).
      setters.setPinError(null);
      setters.setManageError(null);
      setters.setLoadError(null);
    },
    onPinError: (message: string) => setters.setPinError(message),
    onManageStart: () => {
      // Symmetric with onPinStart: a new manage attempt supersedes stale
      // pin/browse errors too, so a successful manage never leaves an
      // obsolete message on screen (review r1 B2 family, wi pi#51).
      setters.setManageError(null);
      setters.setPinError(null);
      setters.setLoadError(null);
    },
    onManageError: (message: string) => setters.setManageError(message),
  };
}

/** Render precedence: a manage failure (wi pi#52) outranks a pin failure,
 * which outranks a stale browse error, which outranks the externally
 * supplied `error` prop. null when nothing to show. */
export function pickerErrorMessage(state: {
  manageError: string | null;
  pinError: string | null;
  loadError: string | null;
  external: string | null | undefined;
}): string | null {
  return state.manageError ?? state.pinError ?? state.loadError ?? state.external ?? null;
}

/**
 * Row path-edit lifecycle seam (wi pi#52): the inline PATH editor's
 * behavior as ONE production-used helper so tests drive the real rules
 * without a DOM —
 *
 * - `begin` prefills the input with the entry's CURRENT path and clears
 *   any previous row error,
 * - `commit` trims and delegates to the outcome-returning manage
 *   callback: success (including the same-identity no-op) closes the
 *   editor; a refusal KEEPS it open with the typed message under it,
 * - `cancel` closes the editor unchanged and never invokes the callback.
 */
export function createRowPathEdit(deps: {
  entryPath: () => string;
  onCommit: (currentPath: string, nextPath: string) => ManageOutcome;
  setEditing: (editing: boolean) => void;
  setValue: (value: string) => void;
  setError: (message: string | null) => void;
}) {
  return {
    begin() {
      deps.setValue(deps.entryPath());
      deps.setError(null);
      deps.setEditing(true);
    },
    change(value: string) {
      deps.setValue(value);
    },
    cancel() {
      deps.setEditing(false);
      deps.setError(null);
    },
    commit(value: string) {
      const outcome = deps.onCommit(deps.entryPath(), value.trim());
      if (outcome.ok) {
        deps.setEditing(false);
        deps.setError(null);
      } else {
        deps.setError(outcome.error);
      }
    },
  };
}

/**
 * Field keydown seam (review r1 B1, wi pi#51): the inline inputs'
 * Enter/Escape handling as ONE production-used helper so tests drive
 * the real rules without a DOM. Escape cancels ONLY the field's own
 * edit: preventDefault suppresses the browser default and
 * stopPropagation keeps the dialog-level Escape handler from ALSO
 * firing and dismissing the whole picker.
 */
export function createPickerFieldKeyDown(seam: {
  submit: () => void;
  cancel: () => void;
}): (event: { key: string; preventDefault(): void; stopPropagation(): void }) => void {
  return (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      seam.submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      seam.cancel();
    }
  };
}

/**
 * Dialog keydown seam (review r1 B1, wi pi#51): an Escape that a nested
 * field already consumed (defaultPrevented) is treated as handled and
 * does NOT dismiss the dialog — defense in depth behind stopPropagation.
 */
export function dialogEscapeDismisses(
  event: { key: string; defaultPrevented: boolean },
  opts: { busy: boolean; onCancel: () => void },
): void {
  if (event.key === "Escape" && !opts.busy && !event.defaultPrevented) opts.onCancel();
}

/**
 * Create-flow seam (review P2 races): the picker's new-folder/new-file
 * submission lifecycle, as ONE production-used helper so tests drive the
 * real guards —
 *
 * - `open` is a no-op while a creation is pending (no form replacement
 *   mid-flight),
 * - `cancel` hides the form but NEVER clears an outstanding operation's
 *   busy state (the in-flight request keeps ownership until it completes),
 * - a folder completion navigates into the created folder ONLY when the
 *   picker still displays the submit-time directory; if the user navigated
 *   meanwhile, the currently displayed listing is refreshed instead,
 * - everything else delegates to the engine's runCreateSubmission.
 */
export function createCreateFlow(deps: {
  t: Translate;
  fetchFn?: typeof fetch;
  setKind: (kind: "folder" | "file" | null) => void;
  setName: (name: string) => void;
  setError: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
  setNotice: (message: string | null) => void;
  /** The directory the picker currently DISPLAYS (read at submit and at completion). */
  displayedPath: () => string;
  navigateTo: (directory: string) => void;
  refetchCurrent: () => void;
}) {
  let pending = false;
  let submitPath = "";
  return {
    isPending: () => pending,
    open(kind: "folder" | "file") {
      if (pending) return; // no replacement while a creation is in flight
      deps.setKind(kind);
      deps.setName("");
      deps.setError(null);
      deps.setNotice(null);
    },
    cancel() {
      // While a submission is pending the form STAYS visible: hiding it
      // would swallow the operation's eventual failure (the in-dialog
      // error renders only inside the form). Cancel applies to an idle
      // form only.
      if (pending) return;
      deps.setKind(null);
      deps.setName("");
      deps.setError(null);
    },
    async submit(kind: "folder" | "file", rawName: string) {
      if (pending) return;
      const currentPath = deps.displayedPath();
      if (!currentPath) return;
      pending = true;
      submitPath = currentPath;
      try {
        await runCreateSubmission({
          kind,
          rawName,
          currentPath,
          fetchFn: deps.fetchFn,
          translateIssue: (issue) => deps.t(`directoryPicker.validation.${issue}`),
          conflictMessage: deps.t(kind === "folder" ? "directoryPicker.mkdirConflict" : "directoryPicker.createFileConflict"),
          onBusy: deps.setBusy,
          onFormError: deps.setError,
          onFolderCreated: (joinedPath) => {
            deps.setKind(null);
            deps.setName("");
            deps.setNotice(null);
            if (deps.displayedPath() === submitPath) {
              deps.navigateTo(joinedPath);
            } else {
              deps.refetchCurrent();
            }
          },
          onFileCreated: () => {
            deps.setKind(null);
            deps.setName("");
            deps.setNotice(deps.t("directoryPicker.fileCreated"));
          },
          onListingRefresh: () => deps.refetchCurrent(),
        });
      } finally {
        pending = false;
      }
    },
  };
}

/**
 * Row-scoped create flow (wi pi#49 R3): the same engine submission
 * (runCreateSubmission — unsafe names issue zero requests, 409/207 are
 * typed in-dialog failures) but rooted at a ROW's directory instead of
 * the currently browsed one, and with a NO-NAVIGATION completion:
 * - a folder success refreshes the displayed listing (never enters the
 *   created folder),
 * - a file success confirms via i18n and refreshes,
 * - the picker dialog never navigates and never closes on a row create,
 * - the same pending guards as the top-level flow: `open`/`cancel` are
 *   no-ops while a creation is in flight, so a mid-flight cancel can never
 *   swallow the eventual in-dialog failure.
 * The row's directory is re-read at submit time through `rowPath`, so a
 * stale closure can never retarget the creation.
 */
export function createRowCreateFlow(deps: {
  t: Translate;
  fetchFn?: typeof fetch;
  setKind: (kind: "folder" | "file" | null) => void;
  setName: (name: string) => void;
  setError: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
  setNotice: (message: string | null) => void;
  /** The ROW's directory the creation targets (read at submit time). */
  rowPath: () => string;
  /** Which list the row belongs to (read at submit time). */
  scope: () => "browse" | "manage";
  /** Enters a browsed directory (SplitPaneLayout unaffected — the picker
   *  only re-reads its listing). */
  navigateTo: (directory: string) => void;
}) {
  let pending = false;
  let submittedScope: "browse" | "manage" = "browse";
  return {
    isPending: () => pending,
    open(kind: "folder" | "file", scope: "browse" | "manage") {
      if (pending) return; // no replacement while a creation is in flight
      submittedScope = scope;
      deps.setKind(kind);
      deps.setName("");
      deps.setError(null);
      deps.setNotice(null);
    },
    cancel() {
      // An idle form hides; a pending one STAYS visible so the in-flight
      // operation's eventual failure is not swallowed.
      if (pending) return;
      deps.setKind(null);
      deps.setName("");
      deps.setError(null);
    },
    async submit(kind: "folder" | "file", rawName: string) {
      if (pending) return;
      const currentPath = deps.rowPath();
      if (!currentPath) return;
      pending = true;
      try {
        await runCreateSubmission({
          kind,
          rawName,
          currentPath,
          fetchFn: deps.fetchFn,
          translateIssue: (issue) => deps.t(`directoryPicker.validation.${issue}`),
          conflictMessage: deps.t(kind === "folder" ? "directoryPicker.mkdirConflict" : "directoryPicker.createFileConflict"),
          onBusy: deps.setBusy,
          onFormError: deps.setError,
          onFolderCreated: () => {
            deps.setKind(null);
            deps.setName("");
            if (submittedScope === "browse") {
              // Browse-row folder (review B2): the created entry is a child
              // of the ROW's directory and can never appear in the parent
              // listing — enter the row's directory so the result is
              // immediately visible.
              deps.setNotice(null);
              deps.navigateTo(currentPath);
            } else {
              // Manage rows render only the listed directory entries
              // themselves; a created child is not representable here, so
              // the typed notice is the feedback.
              deps.setNotice(deps.t("directoryPicker.folderCreated"));
            }
          },
          onFileCreated: () => {
            deps.setKind(null);
            deps.setName("");
            deps.setNotice(deps.t("directoryPicker.fileCreated"));
          },
          onListingRefresh: () => {},
        });
      } finally {
        pending = false;
      }
    },
  };
}

/**
 * Show-hidden checkbox (props-only presentational export): the checked
 * state and persistence live with the picker through the browse engine.
 */
export function PickerShowHiddenToggle({
  t,
  checked,
  disabled,
  onChange,
}: {
  t: Translate;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className="directory-picker-show-hidden"
      title={t("directoryPicker.showHidden")}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: disabled ? "default" : "pointer", color: "var(--text-muted)", fontSize: 11, flexShrink: 0, opacity: disabled ? 0.5 : 1 }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{t("directoryPicker.showHidden")}</span>
    </label>
  );
}

/**
 * Inline create form (props-only presentational export) shared by the
 * new-folder and new-file toolbar actions; the flow logic lives with the
 * picker through the browse engine.
 */
export function PickerCreateForm({
  t,
  kind,
  value,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  t: Translate;
  kind: "folder" | "file";
  value: string;
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const isFile = kind === "file";
  return (
    <div className="directory-picker-create-form" style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        {isFile ? <FileIcon /> : <FolderIcon />}
        <input
          type="text"
          value={value}
          autoFocus
          placeholder={t(isFile ? "directoryPicker.fileName" : "directoryPicker.folderName")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={createPickerFieldKeyDown({ submit: onSubmit, cancel: onCancel })}
          style={{ minWidth: 0, flex: 1, height: 28, padding: "0 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11, boxSizing: "border-box" }}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          style={{ padding: "5px 12px", border: 0, borderRadius: 5, background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 11, fontWeight: 600, cursor: busy || !value.trim() ? "not-allowed" : "pointer", opacity: busy || !value.trim() ? 0.65 : 1 }}
        >
          {busy ? t("i18n.checking") : t("directoryPicker.createFolder")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ padding: "5px 12px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-hover)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}
        >
          {t("i18n.cancel")}
        </button>
      </div>
      {error && (
        <div style={{ color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{error}</div>
      )}
    </div>
  );
}

/**
 * Inline row-scoped create panel (wi pi#49 R3, props-only presentational
 * export): the file-or-folder choice plus the shared create form, expanded
 * in place under the row whose “New” button was activated. The lifecycle
 * lives with the picker through the row create flow seam.
 */
export function PickerRowCreatePanel({
  t,
  kind,
  value,
  busy,
  error,
  onKindChange,
  onChange,
  onSubmit,
  onCancel,
}: {
  t: Translate;
  kind: "folder" | "file";
  value: string;
  busy: boolean;
  error: string | null;
  onKindChange: (kind: "folder" | "file") => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const choiceStyle = (active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 9px",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    borderRadius: 5,
    background: active ? "var(--bg-hover)" : "none",
    color: active ? "var(--accent)" : "var(--text-muted)",
    fontSize: 11,
    cursor: "pointer",
    flexShrink: 0,
  });
  return (
    <div className="directory-picker-row-create" style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, padding: "4px 8px 8px 30px" }}>
      <div style={{ display: "flex", gap: 6 }} role="group" aria-label={t("directoryPicker.rowNew")}>
        <button type="button" aria-pressed={kind === "folder"} onClick={() => onKindChange("folder")} style={choiceStyle(kind === "folder")}>
          <FolderIcon />
          <span>{t("directoryPicker.rowNewFolderChoice")}</span>
        </button>
        <button type="button" aria-pressed={kind === "file"} onClick={() => onKindChange("file")} style={choiceStyle(kind === "file")}>
          <FileIcon />
          <span>{t("directoryPicker.rowNewFileChoice")}</span>
        </button>
      </div>
      <PickerCreateForm
        t={t}
        kind={kind}
        value={value}
        busy={busy}
        error={error}
        onChange={onChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}

/**
 * One browsed-directory row (props-only presentational export): a row
 * CONTAINER holding the navigation button and — only when the store owner
 * provided a pin callback — a pin button as a SIBLING (never nested, so
 * clicking pin cannot trigger row navigation).
 */
export function PickerBrowseRow({
  entry,
  t,
  onNavigate,
  onPin,
  onNew,
}: {
  entry: BrowseDirectoryEntry;
  t: Translate;
  onNavigate: (path: string) => void;
  onPin?: (path: string) => void;
  /** Row-scoped create (wi pi#49 R3): opens the inline create form for THIS
   *  row's directory. Only directory rows receive it — drive rows never do. */
  onNew?: (path: string) => void;
}) {
  return (
    <div className="directory-picker-row" style={{ display: "flex", alignItems: "stretch" }}>
      <button
        className="directory-picker-entry"
        type="button"
        onClick={() => onNavigate(entry.path)}
        title={entry.path}
        style={{ flex: 1, minWidth: 0, minHeight: 30, display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11 }}
      >
        <FolderIcon />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
      </button>
      {onNew && (
        <button
          className="directory-picker-row-new"
          type="button"
          onClick={() => onNew(entry.path)}
          title={t("directoryPicker.rowNew")}
          aria-label={t("directoryPicker.rowNew")}
          style={{ width: 30, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, border: 0, borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
          onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <PlusIcon />
        </button>
      )}
      {onPin && (
        <button
          className="directory-picker-pin"
          type="button"
          onClick={() => onPin(entry.path)}
          title={t("directoryPicker.pinDirectory")}
          aria-label={t("directoryPicker.pinDirectory")}
          style={{ width: 30, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, border: 0, borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
          onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <PinGlyph />
        </button>
      )}
    </div>
  );
}

/** Windows drive row (props-only): navigation only, never a pin affordance. */
export function PickerDriveRow({
  entry,
  onNavigate,
}: {
  entry: BrowseDirectoryEntry;
  onNavigate: (path: string) => void;
}) {
  return (
    <button
      className="directory-picker-entry"
      type="button"
      onClick={() => onNavigate(entry.path)}
      title={entry.path}
      style={{ width: "100%", minHeight: 34, display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", border: 0, borderRadius: 5, background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: 11 }}
    >
      <DriveIcon />
      <span>{entry.name}</span>
    </button>
  );
}

/**
 * One sidebar-list entry row (props-only presentational export, wi pi#52):
 * the path label plus optional per-row affordances — inline PATH rename
 * (the rename button switches the row to a path editor prefilled with the
 * entry's current path), delete, and the row-scoped create “New” button.
 * Each affordance renders only when its outcome-returning callback is
 * provided, so a consumer that passes none sees a plain read-only row.
 */
export function ManagedEntryRow({
  entry,
  t,
  onRename,
  onRemove,
  onNew,
}: {
  entry: PickerManagedEntry;
  t: Translate;
  /** Inline PATH edit: success (or same-identity no-op) closes the editor;
   *  a refusal keeps it open with the typed message under the input. */
  onRename?: (path: string, nextPath: string) => ManageOutcome;
  onRemove?: (path: string) => ManageOutcome;
  /** Row-scoped create (wi pi#49 R3): opens the inline create form for THIS
   *  row's directory. */
  onNew?: (path: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  // The entry's path is re-read through a ref so the edit seam always
  // commits against the CURRENT entry, never a stale closure.
  const entryPathRef = useRef(entry.path);
  entryPathRef.current = entry.path;

  const pathEdit = useMemo(() => createRowPathEdit({
    entryPath: () => entryPathRef.current,
    onCommit: (currentPath, nextPath) =>
      onRename ? onRename(currentPath, nextPath) : { ok: true },
    setEditing,
    setValue: setEditValue,
    setError: setEditError,
  }), [onRename]);

  if (editing) {
    return (
      <div className="directory-picker-row-path-edit" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="text"
            value={editValue}
            autoFocus
            placeholder={t("directoryPicker.entryPath")}
            onChange={(event) => pathEdit.change(event.target.value)}
            onKeyDown={createPickerFieldKeyDown({ submit: () => pathEdit.commit(editValue), cancel: () => pathEdit.cancel() })}
            style={{ minWidth: 0, flex: 1, height: 26, padding: "0 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          />
          <button type="button" onClick={() => pathEdit.commit(editValue)} title={t("directoryPicker.renameEntry")} aria-label={t("directoryPicker.renameEntry")} style={{ padding: "3px 8px", border: 0, borderRadius: 5, background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>
            {t("directoryPicker.renameEntry")}
          </button>
        </div>
        {editError && (
          <div style={{ color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{editError}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
      <span title={entry.path} style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 11, color: entry.displayName ? "var(--text)" : "var(--text-muted)" }}>
        {entry.displayName ?? entry.path}
      </span>
      {onNew && (
        <button
          className="directory-picker-row-new"
          type="button"
          onClick={() => onNew(entry.path)}
          title={t("directoryPicker.rowNew")}
          aria-label={t("directoryPicker.rowNew")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: 0, borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <PlusIcon />
        </button>
      )}
      {onRename && (
        <button
          type="button"
          onClick={() => pathEdit.begin()}
          title={t("directoryPicker.renameEntry")}
          aria-label={t("directoryPicker.renameEntry")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: 0, borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
        >
          <PencilIcon />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(entry.path)}
          title={t("directoryPicker.removeEntry")}
          aria-label={t("directoryPicker.removeEntry")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: 0, borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(event) => { event.currentTarget.style.color = "#ef4444"; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

/**
 * The manage panel (props-only presentational export): the sidebar's
 * directory list with the per-row inline PATH rename, delete and “New”
 * affordances (wi pi#52 / pi#49 R3). The manage callbacks are
 * outcome-returning (ManageOutcome): a refusal's message is surfaced by
 * the row/dialog, never swallowed. An empty list renders the placeholder
 * only — no rows, no controls.
 */
export function PickerManagePanel({
  t,
  entries,
  onRename,
  onRemove,
  onNew,
  renderRowCreate,
}: {
  t: Translate;
  entries: readonly PickerManagedEntry[];
  onRename?: (path: string, nextPath: string) => ManageOutcome;
  onRemove?: (path: string) => ManageOutcome;
  onNew?: (path: string) => void;
  renderRowCreate?: (path: string) => ReactNode;
}) {
  return (
    <div className="directory-picker-manage" style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <div style={{ padding: "0 8px 6px", color: "var(--text-dim)", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {t("directoryPicker.entriesTitle")}
      </div>
      {entries.length === 0 && (
        <div style={{ padding: "4px 8px 8px", color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.noEntries")}</div>
      )}
      {entries.map((entry) => (
        <Fragment key={entry.path}>
          <ManagedEntryRow
            entry={entry}
            t={t}
            onRename={onRename}
            onRemove={onRemove}
            onNew={onNew}
          />
          {renderRowCreate?.(entry.path) ?? null}
        </Fragment>
      ))}
    </div>
  );
}

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
  /**
   * Manage mode (optional): when `entries` is provided the dialog also shows
   * the sidebar's directory list with rename/remove affordances. Absent, the
   * dialog behaves exactly as before — browse, select, cancel.
   */
  entries?: readonly PickerManagedEntry[];
  /** Inline PATH rename (wi pi#52): outcome-returning — success closes the
   *  row's editor, a refusal's message keeps it open under the input. */
  onRenameEntryPath?: (path: string, nextPath: string) => ManageOutcome;
  /** Outcome-returning delete (wi pi#52): a refusal's message surfaces in
   *  the dialog's error area. */
  onRemoveEntry?: (path: string) => ManageOutcome;
  /**
   * Optional pin callback (wi pi#47): when provided, each browsed-directory
   * row gains a pin (固定) button that adds that directory to the sidebar's
   * user-managed custom list WITHOUT closing or navigating the picker. The
   * store owner (SessionSidebar) validates the directory first and owns all
   * store mutation; a failure surfaces as a typed error in-dialog and reports
   * no success. Absent — e.g. the plain customPath picker — no pin renders.
   */
  onPinDirectory?: (path: string) => Promise<PinOutcome>;
}

export function DirectoryPicker({ onCancel, onSelect, initialPath, busy = false, error, entries, onRenameEntryPath, onRemoveEntry, onPinDirectory }: Props) {
  const { t } = useI18n();
  const manage = entries !== undefined;
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [directories, setDirectories] = useState<BrowseDirectoryEntry[]>([]);
  const [drives, setDrives] = useState<BrowseDirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Persisted show-hidden checkbox (localStorage, default unchecked). The
  // engine reads it at request time through the ref so a toggle refetches
  // with the NEW value without recreating the controller.
  const [showHidden, setShowHidden] = useState(false);
  const showHiddenRef = useRef(false);
  // Create flows (browse-area toolbar, both modes): inline name form + typed
  // error/notice state shared by new-folder and new-file.
  const [createKind, setCreateKind] = useState<"folder" | "file" | null>(null);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  // Error lifecycle (review P2): one production-used seam owns clearing —
  // new requests reset stale errors, success clears browse errors, and a
  // pin failure can never be masked by a leftover browse error.
  const pickerErrors = useMemo(() => createPickerErrorState({ setLoadError, setPinError, setManageError }), []);

  const handleResult = useCallback((result: BrowseResult) => {
    setCurrentPath(result.path);
    currentPathRef.current = result.path;
    setParentDirectory(result.parentPath);
    setPathInput(result.path);
    setDirectories(result.directories);
    setDrives(result.drives);
    pickerErrors.onBrowseSuccess();
  }, [pickerErrors]);

  const controller = useMemo<BrowseController>(() => createBrowseController({
    showHidden: () => showHiddenRef.current,
    onLoading: (isLoading) => {
      setLoading(isLoading);
      if (isLoading) pickerErrors.onBrowseStart();
    },
    onResult: handleResult,
    onError: (message) => pickerErrors.onBrowseError(message),
  }), [handleResult, pickerErrors]);
  const controllerRef = useRef<BrowseController>(controller);
  controllerRef.current = controller;

  // Show-hidden lifecycle (composed production seam): initialization and
  // toggle both go through createShowHiddenLifecycle — the SAME code the
  // behavioral tests drive. Toggling reloads the CURRENT browsed directory
  // (never the initial path); stale responses are dropped by the engine's
  // request-sequence guard.
  const showHiddenLifecycle = useMemo(() => createShowHiddenLifecycle({
    storage: () => (typeof window === "undefined" ? null : window.localStorage),
    onPreference: (checked) => {
      showHiddenRef.current = checked;
      setShowHidden(checked);
    },
    reload: () => void controllerRef.current.refetchCurrent(),
  }), []);

  const handleToggleShowHidden = useCallback((next: boolean) => {
    showHiddenLifecycle.toggle(next);
  }, [showHiddenLifecycle]);

  useEffect(() => {
    setPortalTarget(document.body);
    // Fresh mount (and reopen): the persisted preference initializes the
    // checkbox before the first browse; a throwing storage getter (browser
    // storage policy) degrades to unchecked WITHOUT aborting the browse.
    showHiddenLifecycle.initialize();
    void controllerRef.current.browse(initialPath || undefined);
  }, [initialPath, controller, showHiddenLifecycle]);

  const navigateTo = useCallback((directory?: string) => {
    void controllerRef.current.browse(directory);
  }, []);

  // The directory the picker currently DISPLAYS, readable synchronously by
  // the create flow at submit and completion time (state is async).
  const currentPathRef = useRef("");

  // Create-flow seam (review P2 races): open/cancel/submit all go through
  // ONE production helper whose guards the tests drive directly.
  const createFlow = useMemo(() => createCreateFlow({
    t,
    setKind: setCreateKind,
    setName: setCreateName,
    setError: setCreateError,
    setBusy: setCreateBusy,
    setNotice: setCreateNotice,
    displayedPath: () => currentPathRef.current,
    navigateTo: (directory) => navigateTo(directory),
    refetchCurrent: () => void controllerRef.current.refetchCurrent(),
  }), [t, navigateTo]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) navigateTo(candidate);
  };
  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy;
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  // Note (wi pi#49 R3): the browse-area toolbar that opened this top-level
  // create form is removed — per-row “New” buttons are the replacement and
  // run through the row-scoped flow below. The form itself (and its race
  // guards in the createCreateFlow seam) stays mounted for the row-flow
  // parity the tests exercise; the row flow never opens it.
  const cancelCreate = useCallback(() => {
    createFlow.cancel();
  }, [createFlow]);

  // Browse-area creation, shared by both modes. The whole submission
  // lifecycle — including the race guards the review demanded — lives in
  // the createCreateFlow seam below (the SAME production code the tests
  // drive): no replacement while a creation is pending, cancel never
  // clears an outstanding operation's busy state, and a folder completion
  // only navigates when the picker still displays the submit-time
  // directory. The request orchestration itself is the engine's
  // runCreateSubmission (unsafe names: zero requests; non-OK bodies incl.
  // HTTP 207: typed in-dialog failures with the listing preserved).
  const handleSubmitCreate = useCallback(async () => {
    if (!createKind) return;
    await createFlow.submit(createKind, createName);
  }, [createFlow, createKind, createName]);

  // Manage-mode row actions (wi pi#52): every attempt resets the previous
  // manage error first; a delete refusal's message surfaces in the dialog
  // error area (a rename refusal is surfaced by the row's own editor).
  const handleManageRename = useMemo(
    () => onRenameEntryPath
      ? (path: string, nextPath: string): ManageOutcome => {
          pickerErrors.onManageStart();
          return onRenameEntryPath(path, nextPath);
        }
      : undefined,
    [onRenameEntryPath, pickerErrors],
  );
  const handleManageRemove = useMemo(
    () => onRemoveEntry
      ? (path: string): ManageOutcome => {
          pickerErrors.onManageStart();
          const outcome = onRemoveEntry(path);
          if (!outcome.ok) pickerErrors.onManageError(outcome.error);
          return outcome;
        }
      : undefined,
    [onRemoveEntry, pickerErrors],
  );

  // Per-row pin: only when the store owner provided the callback. A pin
  // never navigates, refetches or closes the picker; each new attempt
  // resets the previous pin error, and a failure surfaces the typed error
  // in-dialog and reports no success.
  const handleRowPin = useMemo(
    () => onPinDirectory
      ? (() => {
          const pin = createRowPinHandler({
            onPin: onPinDirectory,
            onError: (message) => pickerErrors.onPinError(message),
          });
          return (path: string) => {
            pickerErrors.onPinStart();
            return pin(path);
          };
        })()
      : undefined,
    [onPinDirectory, pickerErrors],
  );

  // Per-row create (wi pi#49 R3): one inline form at a time, scoped to the
  // row whose “New” button was activated. `rowCreateScope`+`rowCreatePath`
  // identify the owning row; the row's directory is re-read at submit time
  // through the ref, so a stale flow closure can never retarget a creation.
  // A successful creation closes the form (kind → null) and refreshes the
  // displayed listing — never a navigation, never a dialog close.
  const [rowCreateScope, setRowCreateScope] = useState<"browse" | "manage" | null>(null);
  const [rowCreatePath, setRowCreatePath] = useState("");
  const [rowCreateKind, setRowCreateKind] = useState<"folder" | "file" | null>(null);
  const [rowCreateName, setRowCreateName] = useState("");
  const [rowCreateError, setRowCreateError] = useState<string | null>(null);
  const [rowCreateBusy, setRowCreateBusy] = useState(false);
  const rowCreatePathRef = useRef("");
  rowCreatePathRef.current = rowCreatePath;

  const rowCreateFlow = useMemo(() => createRowCreateFlow({
    t,
    setKind: setRowCreateKind,
    setName: setRowCreateName,
    setError: setRowCreateError,
    setBusy: setRowCreateBusy,
    setNotice: setCreateNotice,
    rowPath: () => rowCreatePathRef.current,
    scope: () => rowCreateScopeRef.current,
    navigateTo: (directory) => void controllerRef.current.browse(directory),
  }), [t]);

  const rowCreateOpenFor = useCallback((scope: "browse" | "manage", path: string): boolean =>
    rowCreateScope === scope && rowCreatePath === path && rowCreateKind !== null,
    [rowCreateScope, rowCreatePath, rowCreateKind],
  );

  const rowCreateScopeRef = useRef<"browse" | "manage">("browse");
  rowCreateScopeRef.current = rowCreateScope ?? "browse";
  const openRowCreate = useCallback((scope: "browse" | "manage", path: string) => {
    if (rowCreateFlow.isPending()) return; // no replacement while a creation is in flight
    setRowCreateScope(scope);
    setRowCreatePath(path);
    rowCreateFlow.open("folder", scope);
  }, [rowCreateFlow]);

  const handleRowCreateCancel = useCallback(() => {
    rowCreateFlow.cancel();
  }, [rowCreateFlow]);

  const handleRowCreateSubmit = useCallback(async () => {
    if (rowCreateKind == null) return;
    await rowCreateFlow.submit(rowCreateKind, rowCreateName);
  }, [rowCreateFlow, rowCreateKind, rowCreateName]);

  const renderRowCreatePanel = useCallback((scope: "browse" | "manage", path: string): ReactNode => (
    rowCreateOpenFor(scope, path) ? (
      <PickerRowCreatePanel
        t={t}
        kind={rowCreateKind!}
        value={rowCreateName}
        busy={rowCreateBusy}
        error={rowCreateError}
        onKindChange={setRowCreateKind}
        onChange={(value) => { setRowCreateName(value); setRowCreateError(null); }}
        onSubmit={() => void handleRowCreateSubmit()}
        onCancel={handleRowCreateCancel}
      />
    ) : null
  ), [t, rowCreateOpenFor, rowCreateKind, rowCreateName, rowCreateBusy, rowCreateError, handleRowCreateSubmit, handleRowCreateCancel]);

  if (!portalTarget) return null;

  return createPortal(
    <div
      className="directory-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("directoryPicker.selectDirectory")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      onKeyDown={(event) => dialogEscapeDismisses(event, { busy, onCancel })}
      style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
    >
      <div className="directory-picker-panel" style={{ width: 520, maxWidth: "calc(100vw - 16px)", height: "min(620px, calc(100dvh - 16px))", maxHeight: "calc(100dvh - 16px)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 15 }}>{t("directoryPicker.selectDirectory")}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{ padding: "2px 6px", border: 0, background: "none", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handlePathSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <button className="directory-picker-back" type="button" onClick={() => navigateTo(parentDirectory ?? undefined)} disabled={loading || !canNavigateUp} title={t("directoryPicker.goToParent")} aria-label={t("directoryPicker.goToParent")} style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: canNavigateUp ? "pointer" : "default", opacity: canNavigateUp ? 1 : 0.45 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
            {t("directoryPicker.directoryPath")}
          </label>
          <input
            className="directory-picker-path"
            id="directory-path"
            type="text"
            value={pathInput}
            placeholder="/path/to/project or ~/project"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPathInput(event.target.value);
              setLoadError(null);
            }}
            style={{ minWidth: 0, flex: 1, height: 36, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, outline: "none", background: "var(--bg-panel)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          <button
            className="directory-picker-action"
            type="submit"
            disabled={loading || !pathInput.trim()}
            title={t("directoryPicker.goToDirectory")}
            style={{ minWidth: 58, height: 36, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-hover)", color: "var(--text-muted)", cursor: loading || !pathInput.trim() ? "default" : "pointer", opacity: loading || !pathInput.trim() ? 0.6 : 1 }}
          >
            {t("directoryPicker.go")}
          </button>
        </form>

        {createKind && (
          <PickerCreateForm
            t={t}
            kind={createKind}
            value={createName}
            busy={createBusy}
            error={createError}
            onChange={(value) => { setCreateName(value); setCreateError(null); }}
            onSubmit={() => void handleSubmitCreate()}
            onCancel={cancelCreate}
          />
        )}
        {createNotice && (
          <div style={{ padding: "6px 14px 0", color: "var(--text-muted)", fontSize: 11, flexShrink: 0 }}>
            {createNotice}
          </div>
        )}

        <div className="directory-picker-list" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px" }}>
          {loading ? (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.loadingDirectories")}</div>
          ) : drives !== null ? (
            <>
              {drives.length > 0 ? (
                drives.map((drive) => (
                  <PickerDriveRow key={drive.path} entry={drive} onNavigate={(path) => navigateTo(path)} />
                ))
              ) : (
                <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.noDrives")}</div>
              )}
            </>
          ) : directories.length > 0 ? (
            directories.map((entry) => (
              <Fragment key={entry.path}>
                <PickerBrowseRow
                  entry={entry}
                  t={t}
                  onNavigate={(path) => navigateTo(path)}
                  onPin={handleRowPin ? (path) => void handleRowPin(path) : undefined}
                  onNew={(path) => openRowCreate("browse", path)}
                />
                {renderRowCreatePanel("browse", entry.path)}
              </Fragment>
            ))
          ) : (
            <div style={{ padding: 8, color: "var(--text-dim)", fontSize: 11 }}>{t("directoryPicker.noSubdirectories")}</div>
          )}
          {(loadError || error || pinError || manageError) && <div style={{ padding: "8px", color: "#dc2626", fontSize: 11 }}>{pickerErrorMessage({ manageError, pinError, loadError, external: error })}</div>}

          {/* Manage mode (wi pi#52): the sidebar's directory list with the
              outcome-returning per-row delete and inline PATH rename plus
              the per-row “New” affordance (wi pi#49 R3). Absent `entries`
              keeps the dialog exactly as the plain browse/select consumer
              sees it. */}
          {manage && (
            <PickerManagePanel
              t={t}
              entries={entries}
              onRename={handleManageRename}
              onRemove={handleManageRemove}
              onNew={(path) => openRowCreate("manage", path)}
              renderRowCreate={(path) => renderRowCreatePanel("manage", path)}
            />
          )}
        </div>

        {/* Footer (wi pi#49 R3): the persisted show-hidden checkbox sits on
            the LEFT of the same row as cancel and “Select this folder”;
            toggling reloads the current browsed directory. */}
        <div className="directory-picker-footer" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
          <PickerShowHiddenToggle t={t} checked={showHidden} disabled={loading} onChange={handleToggleShowHidden} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <button className="directory-picker-action" type="button" onClick={onCancel} disabled={busy} style={{ padding: "6px 14px", border: "1px solid var(--border)", borderRadius: 6, background: "none", color: "var(--text-muted)", cursor: busy ? "default" : "pointer", fontSize: 13 }}>{t("i18n.cancel")}</button>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("directoryPicker.openBeforeSelecting") : t("directoryPicker.selectCurrentDirectory")}
            style={{ padding: "6px 16px", border: 0, borderRadius: 6, background: "var(--accent)", color: "var(--accent-contrast)", fontSize: 13, fontWeight: 600, opacity: canSelect ? 1 : 0.6, cursor: canSelect ? "pointer" : "default" }}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
