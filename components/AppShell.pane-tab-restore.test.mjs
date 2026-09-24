import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

function slice(startMarker, endMarker, file = source, label = startMarker) {
  const start = file.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker not found`);
  const end = file.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${label}: end marker not found`);
  return file.slice(start, end);
}

// Pane-tab restore (this wi): the restore effect, the writer effect, and the
// pi#27 entry effect were all declared in this order in AppShell.tsx; slice
// them apart by their leading comments so the pins survive minor edits.
const restoreEffect = slice(
  "// Pane-tab restore (this wi): a browser reload re-opens",
  "// Pane-tab persistence writer",
);
const writerEffect = slice(
  "// Pane-tab persistence writer",
  "// pi#27: entry lands on the new-session tab",
);
const entryEffect = slice(
  "// pi#27: entry lands on the new-session tab",
  "setProjectTrust(null)",
);
const selectSessionCallback = slice(
  "const handleSelectSession = useCallback",
  "const handleNewSession = useCallback",
);

test("AppShell consumes the schema-versioned pane-tab store", () => {
  assert.match(source, /import \{ readOpenPaneTabs, writeOpenPaneTabs \} from "@\/lib\/pane-tab-state";/);
  assert.match(restoreEffect, /readOpenPaneTabs\(\)/);
  assert.match(writerEffect, /writeOpenPaneTabs\(paneTabs, focusedPaneId\)/);
});

test("restore is one-shot and gated on the settled catalog, split view, and desktop", () => {
  // Attempt latch: a ref makes the restore run at most once per page load.
  assert.match(restoreEffect, /if \(paneRestoreAttemptedRef\.current\) return;/);
  assert.match(restoreEffect, /paneRestoreAttemptedRef\.current = true;/);
  // Gating: never restore before the sidebar's session list has settled.
  assert.match(restoreEffect, /if \(!sessionCatalogReported\) return;/);
  assert.match(restoreEffect, /if \(!splitPaneEnabled \|\| isMobile\) return;/);
  // The attempt is consumed in every layout mode (also mirrored to state so
  // the entry guard and writer can react to it).
  assert.match(restoreEffect, /setPaneRestoreAttempted\(true\);/);
  // The reported flag itself flips on every settled session-list report.
  assert.match(
    slice("const handleSessionsChange = useCallback", "const handleExternalSessionChange"),
    /setSessionCatalogReported\(true\);/,
  );
});

test("restore resolves persisted ids against the live catalog in persisted order", () => {
  assert.match(restoreEffect, /const byId = new Map\(sessionCatalog\.map\(\(session\) => \[session\.id, session\]\)\);/);
  assert.match(restoreEffect, /for \(const tab of record\?\.tabs \?\? \[\]\) \{/);
  assert.match(restoreEffect, /const session = byId\.get\(tab\.sessionId\);/);
  assert.match(restoreEffect, /if \(!session\) continue;/);
  // Rebuilt tabs carry live labels and project attribution.
  assert.match(restoreEffect, /label: session\.name \|\| tab\.label \|\| session\.firstMessage \|\| session\.id\.slice\(0, 12\)/);
  assert.match(restoreEffect, /projectName: projectDisplayNameForPath\(session\.projectRoot \?\? session\.cwd\)/);
  // Nothing restorable leaves the strip and the pi#27 fallback untouched.
  assert.match(restoreEffect, /if \(restored\.length === 0\) return;/);
});

test("restore resolves focus in the fixed order and keeps the URL consistent", () => {
  // A valid ?session= deep-link target is appended when not already open.
  assert.match(restoreEffect, /const deepLink = initialSessionId \? byId\.get\(initialSessionId\) \?\? null : null;/);
  assert.match(restoreEffect, /if \(deepLink && !restored\.some\(\(t\) => t\.sessionId === deepLink\.id\)\) \{/);
  // Focus order: persisted focused pane, then deep-link target, then first pane.
  assert.match(
    restoreEffect,
    /const focus = persistedFocus && restored\.some\(\(t\) => t\.sessionId === persistedFocus\)\s*\?\s*persistedFocus\s*:\s*deepLink\?\.id \?\? restored\[0\]\.sessionId;/,
  );
  // The workspace last-open restore must not resurrect a different session
  // over the rebuilt strip...
  assert.match(restoreEffect, /invalidateWorkspaceRestore\(\);/);
  // ...and the URL follows the focused pane.
  assert.match(
    restoreEffect,
    /if \(new URLSearchParams\(window\.location\.search\)\.get\("session"\) !== focus\) \{\s*router\.replace\(`\?session=\$\{encodeURIComponent\(focus\)\}`, \{ scroll: false \}\);/,
  );
});

test("restore re-selects the focused pane through the isRestore short-circuit", () => {
  assert.match(restoreEffect, /handleSelectSession\(focusSession, true\);/);
});

test("the pi#27 entry fallback waits for the pane restore attempt and an auto-selected cwd does not supersede an empty strip", () => {
  // The empty-strip-not-superseded rule: in tab mode the sidebar's auto-select
  // (most-recent project) sets activeCwd in the same load window, and without
  // the sentinel tab the split layout renders nothing — so a cwd alone must
  // NOT consume the entry fallback while the strip is empty (the e2e
  // fresh-entry regression).
  assert.match(entryEffect, /const entrySuperseded = splitPaneEnabled && !isMobile/);
  assert.match(entryEffect, /\? Boolean\(selectedSession\) \|\| paneTabs\.length > 0/);
  assert.match(entryEffect, /: Boolean\(selectedSession\) \|\| Boolean\(effectiveNewSessionCwd\) \|\| paneTabs\.length > 0/);
  // Pending-guard: while a persisted strip may still be restored, the entry
  // new-session tab must not fire first.
  assert.match(entryEffect, /if \(splitPaneEnabled && !isMobile && !paneRestoreAttempted\) return;/);
  // The guard is reactive: the attempt state is in the entry effect's deps.
  assert.match(
    entryEffect,
    /\[initialSessionRestored, selectedSession, effectiveNewSessionCwd, paneTabs\.length, splitPaneEnabled, isMobile, paneRestoreAttempted, resolveNewSessionTabCwd, handleNewSession\]/,
  );
  // Once attempted, the existing pi#27 conditions apply unchanged.
  assert.match(entryEffect, /if \(entrySuperseded\) \{/);
  assert.match(entryEffect, /void resolveNewSessionTabCwd\(\)\.then\(\(cwd\) => \{/);
});

test("the writer persists strip changes but never clobbers on mount", () => {
  // Gated on split view, desktop, and restore-attempted: the mount-time empty
  // strip (attempt not consumed yet) writes nothing, and classic/mobile
  // modes persist nothing.
  assert.match(writerEffect, /if \(!splitPaneEnabled \|\| isMobile\) return;/);
  assert.match(writerEffect, /if \(!paneRestoreAttempted\) return;/);
  assert.match(
    writerEffect,
    /\}, \[splitPaneEnabled, isMobile, paneRestoreAttempted, paneTabs, focusedPaneId\]\);/,
  );
});

test("handleSelectSession keeps the split-pane already-open isRestore short-circuit", () => {
  // Regression pin (pre-existing behavior, unchanged by this wi): selecting
  // an already-open session pane scrolls it into view and focuses it — no
  // duplication, no remount.
  assert.match(selectSessionCallback, /const alreadyOpen = tabs\.some\(\(t\) => t\.sessionId === session\.id\);/);
  assert.match(
    selectSessionCallback,
    /if \(alreadyOpen\) \{\s*splitPaneLayoutRef\.current\?\.scrollPaneIntoView\(session\.id\);\s*setFocusedPaneId\(session\.id\);\s*return clearBadgeOnFocus\(tabs, session\.id\);/,
  );
  assert.match(selectSessionCallback, /if \(isRestore\) \{\s*\/\/ Suppress the redundant sessionKey bump/);
});

test("the sidebar reports its session list only after the initial load settles", () => {
  // The restore gate trusts sessionCatalogReported as "the live catalog has
  // settled"; the sidebar must not report its pre-load empty state, or an
  // empty-but-loaded catalog would be indistinguishable from not-yet-loaded.
  assert.match(sidebarSource, /const \[sessionsLoadSettled, setSessionsLoadSettled\] = useState\(false\);/);
  assert.match(sidebarSource, /setSessionsLoadSettled\(true\);/);
  assert.match(
    sidebarSource,
    /if \(!sessionsLoadSettled\) return;\s*onSessionsChange\?\.\(allSessions\);/,
  );
});
