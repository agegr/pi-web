import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// This wi (split-view sidebar follow): focusing a split-view tab must move
// the sidebar highlight (and scroll it into view) without pane focus ever
// writing selectedSession (pi#33 isolation). The derivation must sit beside
// the background-tasks memo with identical inputs so the two surfaces never
// disagree about which session is "current".
const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

const memoStart = source.indexOf("const sidebarSessionId = useMemo(");
assert.ok(memoStart >= 0, "AppShell must derive the sidebar highlight session id");
const memoDepsAt = source.indexOf(
  "[splitPaneEnabled, isMobile, focusedPaneId, selectedSession?.id, paneTabs]",
  memoStart,
);
assert.ok(memoDepsAt > memoStart, "the sidebar memo must use the same deps as the bg-tasks memo");
const sidebarMemo = source.slice(memoStart, source.indexOf(");", memoDepsAt));

const focusStart = source.indexOf("onFocusPane={(sid) => {");
assert.ok(focusStart >= 0, "AppShell must define the split-pane focus handler");
const focusEnd = source.indexOf("onClosePane={(sid) => {", focusStart);
assert.ok(focusEnd > focusStart, "the focus handler must be followed by the close handler");
const focusHandler = source.slice(focusStart, focusEnd);

test("the sidebar highlight derives from the focused pane through resolveSidebarSessionId", () => {
  assert.match(sidebarMemo, /resolveSidebarSessionId\(\{/);
  // The same desktop-split guard the background-tasks memo uses — classic
  // layout (split off) and mobile are excluded by construction.
  assert.match(sidebarMemo, /splitPaneEnabled: splitPaneEnabled && !isMobile/);
  assert.match(sidebarMemo, /selectedSessionId: selectedSession\?\.id \?\? null/);
  assert.match(sidebarMemo, /lastSessionPaneId: lastSessionPaneIdRef\.current/);
  assert.match(sidebarMemo, /paneTabs,/);
  // The derivation itself never writes the classic selection.
  assert.doesNotMatch(sidebarMemo, /setSelectedSession/);
});

test("pane focus keeps the pi#33 isolation: it writes only focusedPaneId", () => {
  assert.match(focusHandler, /setFocusedPaneId\(sid\);/);
  assert.doesNotMatch(focusHandler, /setSelectedSession/,
    "focusing a pane must never touch selectedSession (pi#33)");
  // The sidebar highlight is a derived read, never a selection write: no
  // call site feeds selectedSession back into the sidebar highlight props.
  assert.doesNotMatch(source, /highlightSessionId=\{selectedSession/);
});

test("the SessionSidebar call site carries the derived highlight and the split-only follow gate", () => {
  assert.match(source, /highlightSessionId=\{sidebarSessionId\}/);
  assert.match(source, /followHighlightIntoView=\{splitPaneEnabled && !isMobile\}/);
  // The classic selection prop keeps feeding its classic consumers.
  assert.match(source, /selectedSessionId=\{selectedSession\?\.id \?\? null\}/);
});

test("the sidebar memo sits beside the background-tasks memo with identical inputs", () => {
  // pi#28's memo stays the reference derivation; the sidebar reuses the same
  // focus inputs, so the highlight and the tasks panel can never disagree.
  const bgStart = source.indexOf("const activeBgSessionId = useMemo(");
  assert.ok(bgStart >= 0, "AppShell must keep the background-tasks derivation");
  const bgDepsAt = source.indexOf(
    "[splitPaneEnabled, isMobile, focusedPaneId, selectedSession?.id, paneTabs]",
    bgStart,
  );
  assert.ok(bgDepsAt > bgStart);
  const bgMemo = source.slice(bgStart, source.indexOf(");", bgDepsAt));
  assert.match(bgMemo, /resolveBackgroundTasksSessionId\(\{/);
  assert.match(bgMemo, /splitPaneEnabled: splitPaneEnabled && !isMobile/);
  assert.match(bgMemo, /lastSessionPaneId: lastSessionPaneIdRef\.current/);
  // Both memos read the same ref (declared once, shared).
  assert.equal(source.match(/const lastSessionPaneIdRef = useRef/g)?.length, 1);
});
