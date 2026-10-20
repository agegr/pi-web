/**
 * The sidebar's project filter: the session tree narrowed to the project
 * picked in the file browser.
 *
 * Unfiltered (the default) the tree tiles every project as its own group.
 * Filtered, the same tree keeps the picked project's group and its rows only
 * — the filter is a narrowing of what the tree already knows, never a second
 * list, so grouping, activity, unread markers, "show more" and the archive
 * keep working on it unchanged.
 *
 * This module holds everything the filter itself needs, so merges with
 * upstream only ever touch the wiring points (SessionSidebar, SettingsPanel
 * and ProjectFilterSetting): the filter as a live store, and the pure helper
 * that narrows the tree's rows to the project in use.
 *
 * The narrowing keeps the picked project's group header, its session rows,
 * its "show more" and its empty note, plus the tree's footer link that opens
 * another project. Pinned rows are dropped: they render in the pinned section
 * above every group, which is not part of a project. The archive link follows
 * the filter too — it counts, and opens, the picked project's archived
 * sessions only, and is left out when that project has none.
 * A null key (no project picked yet) keeps just the footer links; the
 * filter's own switch and the file browser are the way forward then.
 */

import { useSyncExternalStore } from "react";
import type { SidebarRow } from "./session-tree";

/** "off" shows every project; "on" narrows the tree to the picked one. */
export type ProjectFilterMode = "off" | "on";

const PROJECT_FILTER_STORAGE_KEY = "pi-web:project-filter";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseProjectFilterMode(raw: string | null): ProjectFilterMode {
  return raw === "on" ? "on" : "off";
}

function readStoredMode(): ProjectFilterMode {
  const storage = getBrowserStorage();
  if (!storage) return "off";
  try {
    return parseProjectFilterMode(storage.getItem(PROJECT_FILTER_STORAGE_KEY));
  } catch {
    return "off";
  }
}

// --- The live store (the useFilesPlacement pattern): Settings › General and
// --- the sidebar share one snapshot, this tab's change reaches the browser's
// --- other tabs through the storage event.

let mode: ProjectFilterMode | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ProjectFilterMode {
  if (mode === null) mode = readStoredMode();
  return mode;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== PROJECT_FILTER_STORAGE_KEY) return;
  const next = readStoredMode();
  if (next === mode) return;
  mode = next;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // Nobody listened for another tab's change meanwhile.
    mode = readStoredMode();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Writes the filter; the sidebar and Settings › General follow at once, the browser's other tabs through the storage event. */
export function setProjectFilterMode(next: ProjectFilterMode): void {
  if (next === getSnapshot()) return;
  mode = next;
  const storage = getBrowserStorage();
  try {
    storage?.setItem(PROJECT_FILTER_STORAGE_KEY, next);
  } catch {
    // Applies in memory even if the browser cannot save it.
  }
  notify();
}

/** The filter of this browser, live. The server renders the default, like the sidebar's own preferences. */
export function useProjectFilterMode(): ProjectFilterMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => "off");
}

// Test hooks (the unit tests run outside a browser).
export const projectFilterInternals = { parseProjectFilterMode, readStoredMode };

// --- Pure helpers.

/**
 * The tree's rows, filtered to the picked project: its group, its rows, its
 * "show more", its empty note, and the footer links that lead elsewhere.
 *
 * The archive link is the picked project's too: it carries that project's
 * archived count instead of the tree's whole one, and is left out when the
 * project has nothing archived (`archivedCount` is that count — the archive
 * view beside it is filtered the same way, so the link opens what it counts).
 */
export function filterRowsByProject(rows: readonly SidebarRow[], projectKey: string | null, archivedCount: number): SidebarRow[] {
  return rows.flatMap((row): SidebarRow[] => {
    switch (row.kind) {
      case "session":
        // Pinned rows carry their project but render in the pinned section,
        // outside any group; the filter keeps a group's own rows.
        return row.context === "group" && row.project.key === projectKey ? [row] : [];
      case "group":
      case "group-empty":
        return row.project.key === projectKey ? [row] : [];
      case "group-more":
        return row.projectKey === projectKey ? [row] : [];
      case "spacer":
        return row.key === "footer-spacer" ? [row] : [];
      case "footer-open":
        return [row];
      case "footer-archived":
        return archivedCount > 0 ? [{ ...row, count: archivedCount }] : [];
      default:
        return [];
    }
  });
}

/**
 * The archive view's rows, filtered to the picked project: its group header,
 * folded or not, and the archived sessions under it. Every project's archive
 * groups look alike there, so the header alone tells them apart.
 */
export function filterArchiveRowsByProject(rows: readonly SidebarRow[], projectKey: string | null): SidebarRow[] {
  return rows.filter((row) => {
    switch (row.kind) {
      case "archive-group":
        return row.project.key === projectKey;
      case "session":
        return row.context === "archive" && row.project.key === projectKey;
      default:
        return false;
    }
  });
}
