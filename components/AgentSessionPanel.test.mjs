import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");
const progressSource = await readFile(new URL("../lib/pi-subagents-progress.ts", import.meta.url), "utf8");

test("keeps the main session first and makes every agent session selectable", () => {
  const mainRow = source.indexOf("session={rootSession}");
  const subagentRows = source.indexOf("visibleSubagents.map");
  assert.ok(mainRow > 0);
  assert.ok(subagentRows > mainRow);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(rootSession\)\}/);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(session\)\}/);
  assert.match(source, /aria-selected=\{selected\}/);
});

test("sorts running subagents first and enables search only for larger families", () => {
  assert.match(source, /if \(aRunning !== bRunning\) return aRunning \? -1 : 1/);
  assert.match(source, /subagents\.length > 8/);
  assert.match(source, /relation\?\.description, relation\?\.profile, session\.name, session\.firstMessage/);
  assert.match(source, /maxHeight: "min\(58dvh, 480px\)"/);
});

test("renders as a compact left-positioned dropdown without a centered inner width", () => {
  assert.match(source, /borderLeft: "1px solid var\(--border\)"/);
  assert.match(source, /borderRadius: "0 0 6px 6px"/);
  assert.doesNotMatch(source, /maxWidth: 680/);
});

test("shows persisted completion states while live running state takes precedence", () => {
  assert.match(source, /return running \|\| progress\?\.status === "running"/);
  assert.match(source, /t\(`agentSwitcher\.status\.\$\{status\}`\)/);
  assert.match(source, /status === "failed"/);
  assert.match(source, /status === "aborted" \|\| status === "interrupted"/);
});

test("hides terminal rows by default and reveals them with the Show completed toggle", () => {
  // Default state is `false`: completed/failed/etc. rows are not rendered.
  assert.match(source, /const \[showCompleted, setShowCompleted\] = useState\(false\)/);
  assert.match(source, /ACTIVE_SUBAGENT_STATUSES: ReadonlySet<SubagentSessionStatus> = new Set\(\["running", "starting"\]\)/);
  assert.match(source, /function isActiveSubagentStatus\(status: SubagentSessionStatus\): boolean \{\s*return ACTIVE_SUBAGENT_STATUSES\.has\(status\);/);
  // Unchecked filters to active statuses; checked shows every matched row.
  assert.match(source, /const visibleSubagents = showCompleted\s*\? searchMatches\s*: searchMatches\.filter\(\(session\) => isActiveSubagentStatus\(statusOf\(session\)\)\)/);
  assert.match(source, /checked=\{showCompleted\}/);
  assert.match(source, /onChange=\{setShowCompleted\}/);
  assert.match(source, /label=\{t\("agentSwitcher\.showCompleted"\)\}/);
});

test("composes search with the status filter instead of replacing it", () => {
  // Search narrows first, then the active-status filter runs over its result,
  // so both conditions apply at once.
  assert.match(source, /const searchMatches = normalizedQuery\s*\? sortedSubagents\.filter/);
  assert.match(source, /const visibleSubagents = showCompleted\s*\? searchMatches\s*: searchMatches\.filter\(\(session\) => isActiveSubagentStatus\(statusOf\(session\)\)\)/);
});

test("shows a dim empty-state hint that can reveal hidden terminal rows", () => {
  assert.match(source, /searchMatches\.length === 0 \? t\("agentSwitcher\.noMatches"\) : t\("agentSwitcher\.noRunning"\)/);
  assert.match(source, /!showCompleted && hiddenTerminalCount > 0/);
  assert.match(source, /const hiddenTerminalCount = showCompleted\s*\? 0\s*: searchMatches\.filter\(\(session\) => !isActiveSubagentStatus\(statusOf\(session\)\)\)\.length/);
});

test("derives the filter from the same status inputs as the row badge", () => {
  // One helper owns the precedence, and both the row badge and the list-level
  // map call it with the same inputs (running id set + run progress).
  assert.match(source, /function subagentStatus\(\s*session: SessionInfo,\s*progress: RunProgress \| undefined,\s*running: boolean,/);
  assert.match(source, /const relation = session\.relation\?\.kind === "subagent" \? session\.relation : null;\s*return running \|\| progress\?\.status === "running"/);
  assert.match(source, /statuses\.set\(session\.id, subagentStatus\(session, runProgress\.get\(session\.id\), running\)\)/);
  assert.match(source, /const statusOf = \(session: SessionInfo\): SubagentSessionStatus => subagentStatuses\.get\(session\.id\) \?\? "completed"/);
  assert.match(source, /status=\{statusOf\(session\)\}/);
  assert.match(source, /status=\{subagentStatus\(rootSession, undefined, runningSessionIds\.has\(rootSession\.id\)\)\}/);
});

test("surfaces per-run progress from the subagent-async snapshot while falling back to relation status", () => {
  // Live runs come in as an optional prop; without one the row keeps using
  // relation.status, so older sessions and the demo still render.
  assert.match(source, /liveRuns\?: PiSubagentSnapshotNode\[\]/);
  assert.match(source, /liveRuns = \[\]/);
  assert.match(source, /progress\?\.status \?\? relation\?\.status \?\? "completed"/);
  // The join is the shared, unit-tested helper; it matches stepRunId first so a
  // multi-step chain maps one run to many rows instead of last-wins.
  assert.match(source, /buildRunProgress\(subagents, liveRuns\)/);
  assert.match(source, /from "@\/lib\/pi-subagents-progress"/);
  // Progress text reuses the existing rows/styles rather than a new panel.
  assert.match(source, /formatRunProgress\(progress, t\)/);
  assert.match(progressSource, /agentSwitcher\.run\.tool/);
  assert.match(progressSource, /agentSwitcher\.run\.turns/);
  assert.match(progressSource, /agentSwitcher\.run\.tools/);
});
