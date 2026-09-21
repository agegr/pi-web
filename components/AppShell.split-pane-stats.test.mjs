import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// pi#23: split-pane ChatWindows never forwarded the usage/stats reporting
// callbacks, so the top-right stats button (renderSessionStatsButton's guard:
// hide when both sessionStats and contextUsage are null) never appeared in
// split view. The session panes must forward both callbacks gated on the
// focused flag, and the sentinel new-session tab must not report at all.
const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

const renderPaneStart = source.indexOf("renderPane={(sid, focused) => {");
assert.ok(renderPaneStart >= 0, "AppShell must define a split renderPane");
const renderPaneEnd = source.indexOf(") : showChat ? (", renderPaneStart);
assert.ok(renderPaneEnd > renderPaneStart, "the split branch must be followed by the classic ChatWindow");
const renderPane = source.slice(renderPaneStart, renderPaneEnd);

const sentinelStart = renderPane.indexOf("if (isNewSessionTab(sid)) {");
assert.ok(sentinelStart >= 0, "renderPane must have a sentinel (new-session tab) branch");
const sentinel = renderPane.slice(sentinelStart, renderPane.indexOf("const paneSession", sentinelStart));

test("the split session pane forwards the reporting callbacks only when focused", () => {
  // Only the focused pane may report: unfocused panes pass undefined so the
  // last writer of the global topbar state is always the focused pane.
  assert.match(
    renderPane,
    /onSessionStatsChange=\{focused \? handleSessionStatsChange : undefined\}/,
    "the session pane must gate onSessionStatsChange on the focused flag",
  );
  assert.match(
    renderPane,
    /onContextUsageChange=\{focused \? handleContextUsageChange : undefined\}/,
    "the session pane must gate onContextUsageChange on the focused flag",
  );
});

test("the sentinel new-session tab renders without any reporting callback", () => {
  // The sentinel pane has no session, so it must not report stats or usage.
  assert.ok(!sentinel.includes("onSessionStatsChange"), "the sentinel pane must not forward onSessionStatsChange");
  assert.ok(!sentinel.includes("onContextUsageChange"), "the sentinel pane must not forward onContextUsageChange");
});

test("the classic full-width ChatWindow still wires both callbacks unconditionally (no regression)", () => {
  assert.match(source, /onSessionStatsChange=\{handleSessionStatsChange\}/);
  assert.match(source, /onContextUsageChange=\{handleContextUsageChange\}/);
});

test("ChatWindow re-reports on callback change and nulls on callback removal", async () => {
  // Focus switches flip the callback identity (handle <-> undefined), so the
  // reporting effect must be keyed on the callback and clean up with null,
  // otherwise the newly focused pane never reports and stale values linger.
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(
    chatWindow,
    /useEffect\(\(\) => \{\s*onSessionStatsChange\?\.\(sessionStatsRef\.current\);\s*\}, \[statsKey, onSessionStatsChange\]\);/,
  );
  assert.match(
    chatWindow,
    /useEffect\(\(\) => \(\) => \{ onSessionStatsChange\?\.\(null\); \}, \[onSessionStatsChange\]\);/,
  );
  assert.match(
    chatWindow,
    /useEffect\(\(\) => \{\s*onContextUsageChange\?\.\(contextUsageRef\.current\);\s*\}, \[ctxKey, onContextUsageChange\]\);/,
  );
  assert.match(
    chatWindow,
    /useEffect\(\(\) => \(\) => \{ onContextUsageChange\?\.\(null\); \}, \[onContextUsageChange\]\);/,
  );
});
