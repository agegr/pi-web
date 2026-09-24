"use client";

/**
 * Multi-root file explorer container (pi#14).
 *
 * Renders one independently collapsible section per explorer root: every
 * pinned project plus (as the trailing section) the currently selected
 * project when it is not already pinned. Sections are collapsed by
 * default; per-section expansion persists in localStorage. A section
 * mounts its own <FileExplorer> only while expanded and non-stale, so a
 * collapsed or missing root never fetches anything.
 *
 * The sidebar toolbar keeps a single upload / file-search / changes / refresh
 * affordance set: upload and file-search delegate here through the
 * imperative handle, which resolves the deterministic target section —
 * the first expanded section in root order, falling back to the first
 * non-stale root — and the aggregated changes count / upload-busy state
 * bubbles up from every mounted section.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import {
  readExplorerSectionExpanded,
  writeExplorerSectionExpanded,
  type ExplorerRoot,
} from "@/lib/explorer-roots";
import {
  getShowBuildOutputs,
  setShowBuildOutputs,
  subscribeShowBuildOutputs,
} from "@/lib/build-outputs-preference";
import { useI18n } from "@/hooks/useI18n";

export interface MultiRootFileExplorerHandle {
  /** Open the upload picker in the deterministic target section. */
  openUploadPicker: () => void;
  /** Open file search in the deterministic target section (expanding it). */
  openFileSearch: () => void;
}

interface Props {
  /** Section roots: pinned projects in pin order, then the selected project. */
  roots: readonly ExplorerRoot[];
  /** Roots confirmed missing on disk: greyed inert headers, no trees. */
  staleRoots?: ReadonlySet<string>;
  homeDir?: string;
  refreshKey?: number;
  onOpenFile: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  changesCollapsed: boolean;
  /** Aggregate changes count summed across all mounted sections. */
  onChangesCountChange?: (count: number) => void;
  /** True while any mounted section is uploading. */
  onUploadBusyChange?: (busy: boolean) => void;
  fileSearchOpen?: boolean;
  onFileSearchOpenChange?: (open: boolean) => void;
  /** Notified on every section toggle (the container persists the state itself). */
  onSectionToggle?: (key: string, expanded: boolean) => void;
}

/** Substitute the home dir prefix with ~ (same convention as the sidebar). */
function displayRoot(root: string, homeDir?: string): string {
  return (homeDir && root.startsWith(homeDir)) ? "~" + root.slice(homeDir.length) : root;
}

export const MultiRootFileExplorer = forwardRef<MultiRootFileExplorerHandle, Props>(
  function MultiRootFileExplorer({
    roots,
    staleRoots = new Set<string>(),
    homeDir,
    refreshKey,
    onOpenFile,
    onAtMention,
    onAtMentions,
    changesCollapsed,
    onChangesCountChange,
    onUploadBusyChange,
    fileSearchOpen = false,
    onFileSearchOpenChange,
    onSectionToggle,
  }, ref) {
    const { t } = useI18n();
    // Single global "show build outputs" toggle (rendered once at the
    // bottom of this block): default off, hydrated from localStorage in
    // an effect (not the initial state) so the server prerender and the
    // first client render agree on "off".
    const [showBuildOutputs, setShowBuildOutputsState] = useState(false);
    useEffect(() => {
      setShowBuildOutputsState(getShowBuildOutputs());
    }, []);
    useEffect(() => {
      // Follow every broadcast (the preference is one global value), so the
      // checkbox stays in step even when another setter drives it.
      return subscribeShowBuildOutputs(({ value }) => {
        setShowBuildOutputsState(value);
      });
    }, []);
    const handleToggleShowBuildOutputs = useCallback(() => {
      const next = !showBuildOutputs;
      // The broadcast drives every mounted FileExplorer's in-place
      // re-fetch (treeRefreshKey bump), including roots expanded later.
      setShowBuildOutputs(next);
      // Apply the EFFECTIVE value: the setter broadcasts the read-back
      // (false when storage failed), and this checkbox must agree with
      // what the explorers actually got (review B1, pi#50).
      setShowBuildOutputsState(getShowBuildOutputs());
    }, [showBuildOutputs]);
    // Sections default to COLLAPSED. The persisted expansion state restores
    // after mount so the server prerender and the first client render agree
    // (same hydration pattern as the pinned-group expansion state).
    const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
      setExpandedKeys(readExplorerSectionExpanded());
    }, []);

    // Per-section aggregates. Refs, not state: the aggregate re-notify runs
    // inside the child callbacks, so it must not re-render this component.
    const changesByKey = useRef(new Map<string, number>());
    const uploadBusyByKey = useRef(new Map<string, boolean>());
    const onChangesCountChangeRef = useRef(onChangesCountChange);
    onChangesCountChangeRef.current = onChangesCountChange;
    const onUploadBusyChangeRef = useRef(onUploadBusyChange);
    onUploadBusyChangeRef.current = onUploadBusyChange;

    const notifyChanges = useCallback(() => {
      let sum = 0;
      for (const count of changesByKey.current.values()) sum += count;
      onChangesCountChangeRef.current?.(sum);
    }, []);

    const notifyUploadBusy = useCallback(() => {
      let busy = false;
      for (const value of uploadBusyByKey.current.values()) busy = busy || value;
      onUploadBusyChangeRef.current?.(busy);
    }, []);

    // Drop aggregate entries for roots that are gone (unpin) so the badge
    // does not keep counting a removed section, then re-notify.
    const rootsKey = roots.map((root) => root.key).join("\n");
    useEffect(() => {
      for (const key of [...changesByKey.current.keys()]) {
        if (!roots.some((root) => root.key === key)) changesByKey.current.delete(key);
      }
      for (const key of [...uploadBusyByKey.current.keys()]) {
        if (!roots.some((root) => root.key === key)) uploadBusyByKey.current.delete(key);
      }
      notifyChanges();
      notifyUploadBusy();
      // Deliberately keyed on the roots identity string only: re-running on
      // aggregate callbacks would loop.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rootsKey]);

    const handleSectionChanges = useCallback((key: string) => (count: number) => {
      changesByKey.current.set(key, count);
      notifyChanges();
    }, [notifyChanges]);

    const handleSectionUploadBusy = useCallback((key: string) => (busy: boolean) => {
      uploadBusyByKey.current.set(key, busy);
      notifyUploadBusy();
    }, [notifyUploadBusy]);

    const sectionHandles = useRef(new Map<string, FileExplorerHandle>());

    const handleToggleSection = useCallback((key: string) => {
      setExpandedKeys((previous) => {
        const next = new Set(previous);
        const expanded = next.has(key);
        if (expanded) next.delete(key);
        else next.add(key);
        writeExplorerSectionExpanded(next);
        onSectionToggle?.(key, !expanded);
        return next;
      });
    }, [onSectionToggle]);

    // Deterministic toolbar target (spec decision D3): the first expanded
    // section in root order, falling back to the first non-stale root.
    const targetRoot =
      roots.find((root) => expandedKeys.has(root.key) && !staleRoots.has(root.root))
      ?? roots.find((root) => !staleRoots.has(root.root))
      ?? null;

    // Review-FAIL blocker 1 fix: openUploadPicker may need to expand the
    // target section first (collapsed sections mount no FileExplorer, so
    // their imperative handle does not exist yet). The delegation therefore
    // waits for the handle to appear via this pending key.
    const [pendingPickerKey, setPendingPickerKey] = useState<string | null>(null);
    useEffect(() => {
      if (!pendingPickerKey) return;
      if (!roots.some((root) => root.key === pendingPickerKey)) {
        setPendingPickerKey(null);
        return;
      }
      const handle = sectionHandles.current.get(pendingPickerKey);
      if (!handle) return; // the section's commit has not mounted it yet
      setPendingPickerKey(null);
      handle.openUploadPicker();
    }, [pendingPickerKey, roots, expandedKeys]);

    useImperativeHandle(ref, () => ({
      openUploadPicker() {
        if (!targetRoot) return;
        const key = targetRoot.key;
        setExpandedKeys((previous) => {
          if (previous.has(key)) return previous;
          const next = new Set([...previous, key]);
          writeExplorerSectionExpanded(next);
          return next;
        });
        setPendingPickerKey(key);
      },
      openFileSearch() {
        if (!targetRoot) return;
        const key = targetRoot.key;
        setExpandedKeys((previous) => {
          if (previous.has(key)) return previous;
          const next = new Set([...previous, key]);
          writeExplorerSectionExpanded(next);
          return next;
        });
        onFileSearchOpenChange?.(true);
      },
    }), [targetRoot, onFileSearchOpenChange]);

    if (roots.length === 0) {
      // Empty root set: the explorer area stays mounted, inert, fetches
      // nothing, and crashes on nothing (spec assumption: empty state).
      return (
        <div
          style={{
            padding: "12px 14px",
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {t("sidebar.explorerEmpty")}
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {roots.map((root) => {
          const stale = staleRoots.has(root.root);
          const expanded = expandedKeys.has(root.key);
          if (stale) {
            // A pinned root that no longer exists on disk: greyed, inert
            // header with the missing-directory hint — no tree fetches.
            return (
              <div
                key={root.key}
                data-explorer-section={root.root}
                title={`${root.root} — ${t("sidebar.pinnedProjectMissing")}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  cursor: "default",
                  overflow: "hidden",
                }}
              >
                <svg
                  width="9" height="9" viewBox="0 0 10 10" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transform: "rotate(-90deg)", opacity: 0.6 }}
                >
                  <polyline points="3 2 7 5 3 8" />
                </svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left", minWidth: 0, flex: 1 }}>
                  <span style={{ unicodeBidi: "plaintext" }}>{root.displayName ?? displayRoot(root.root, homeDir)}</span>
                </span>
              </div>
            );
          }
          return (
            <div key={root.key} style={{ borderBottom: "1px solid var(--border)" }}>
              <button
                onClick={() => handleToggleSection(root.key)}
                aria-expanded={expanded}
                data-explorer-section={root.root}
                title={t(expanded ? "sidebar.explorerSectionCollapse" : "sidebar.explorerSectionExpand", { path: root.root })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "6px 10px",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.05em",
                  textAlign: "left",
                }}
              >
                <svg
                  width="9" height="9" viewBox="0 0 10 10" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transform: expanded ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
                >
                  <polyline points="3 2 7 5 3 8" />
                </svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left", minWidth: 0, flex: 1 }}>
                  <span style={{ unicodeBidi: "plaintext" }}>{root.displayName ?? displayRoot(root.root, homeDir)}</span>
                </span>
              </button>
              {/* One FileExplorer per root, mounted only while its section is
                  expanded: a collapsed section fetches nothing at all. */}
              {expanded && (
                <FileExplorer
                  ref={(handle) => {
                    if (handle) sectionHandles.current.set(root.key, handle);
                    else sectionHandles.current.delete(root.key);
                  }}
                  cwd={root.root}
                  onOpenFile={onOpenFile}
                  refreshKey={refreshKey}
                  onAtMention={onAtMention}
                  onAtMentions={onAtMentions}
                  onUploadBusyChange={handleSectionUploadBusy(root.key)}
                  changesCollapsed={changesCollapsed}
                  onChangesCountChange={handleSectionChanges(root.key)}
                  fileSearchOpen={fileSearchOpen && targetRoot?.key === root.key}
                  onFileSearchOpenChange={onFileSearchOpenChange}
                />
              )}
            </div>
          );
        })}
        {/* Exactly one global "show build outputs" toggle for the whole
            block: at the very bottom, below every root's tree, spanning the
            full block width. */}
        <label
          title={t("files.showBuildOutputsHint")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            width: "100%",
            padding: "4px 10px",
            fontSize: 10,
            color: "var(--text-dim)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={showBuildOutputs}
            onChange={handleToggleShowBuildOutputs}
            aria-label={t("files.showBuildOutputs")}
            style={{ margin: 0 }}
          />
          {t("files.showBuildOutputs")}
        </label>
      </div>
    );
  },
);
