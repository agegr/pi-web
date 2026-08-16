import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const {
  SubagentTree,
  SessionBreadcrumb,
  SubagentComposer,
  DesktopSubagentCard,
  DesktopSubagentWidgetCard,
  countSubagentNodes,
  countActiveSubagentNodes,
  submitActionFor,
  formatElapsed,
  getVisibleNodes,
  buildBreadcrumbItems,
  nextFocusableIndex,
} = await jiti.import("./SubagentSessions.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function node(sessionId, state, overrides = {}) {
  return {
    sessionId,
    parentSessionId: "root",
    runId: "317e1ca0",
    index: 1,
    agent: "worker",
    task: sessionId === null ? "ghost" : `task ${sessionId}`,
    state,
    canSteer: state === "running" || state === "queued" || state === "needs_attention",
    canInterrupt: state === "running" || state === "needs_attention",
    canResume: state === "paused",
    children: [],
    ...overrides,
  };
}

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

const noop = () => {};
const callbacks = { onSelect: noop, onControl: async () => {} };

test("tree renders complete nested nodes with selected row marked", () => {
  const child = node("child", "running", { children: [node("grand", "inactive")] });
  const html = render(React.createElement(SubagentTree, { nodes: [child], selectedSessionId: "child", callbacks }));
  assert.match(html, /role="tree"/);
  assert.match(html, /task child/);
  assert.match(html, /task grand/);
  assert.match(html, /aria-current="true"/);
  assert.match(html, /aria-level="1"/);
  assert.match(html, /aria-level="2"/);
  assert.match(html, /Running/);
  assert.match(html, /Inactive/);
});

test("tree renders disabled starting placeholders with their bounded task text", () => {
  const placeholder = node(null, "starting", { task: "ghost agent" });
  const html = render(React.createElement(SubagentTree, { nodes: [placeholder], selectedSessionId: null, callbacks }));
  assert.match(html, /ghost agent/);
  assert.match(html, /disabled/);
  assert.match(html, /Starting/);
});

test("tree row shows the agent role on its own line above the bounded task", () => {
  const child = node("child", "running", { agent: "worker", task: "Inspect RPC" });
  const html = render(React.createElement(SubagentTree, { nodes: [child], selectedSessionId: null, callbacks }));
  // The task text still appears; the agent is a separate uppercase role label, not inline with it.
  assert.match(html, /Inspect RPC/);
  assert.match(html, /subagent-tree-agent[^>]*>worker/);
  assert.doesNotMatch(html, />worker[^<]*Inspect RPC/);
});

test("tree row omits the task line when the durable task is empty", () => {
  const child = node("child", "inactive", { agent: "worker", task: "" });
  const html = render(React.createElement(SubagentTree, { nodes: [child], selectedSessionId: null, callbacks }));
  assert.match(html, /subagent-tree-agent[^>]*>worker/);
  assert.doesNotMatch(html, /subagent-tree-task/);
});

test("tree rows stack agent, task, and status instead of overlapping in 36px", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /className="subagent-tree-copy"/);
  assert.doesNotMatch(source, /minHeight: 36/);
  assert.match(css, /\.subagent-tree-copy \{[\s\S]*?flex-direction:\s*column;[\s\S]*?gap:\s*2px;/);
  assert.match(css, /\.subagent-tree-row \{[\s\S]*?align-items:\s*flex-start;/);
});

test("tree shows elapsed time when present and hides it otherwise", () => {
  const active = node("a", "running", { elapsedMs: 83_000 });
  const plain = node("b", "inactive");
  const html = render(React.createElement(SubagentTree, { nodes: [active, plain], selectedSessionId: null, callbacks }));
  assert.match(html, /1m 23s/);
  assert.doesNotMatch(html, /0s/);
});

test("tree exposes semantic group nesting with positional ARIA and real disclosure buttons", () => {
  const child = node("child", "running", {
    children: [node("grand", "inactive", { children: [node("great", "complete")] })],
  });
  const other = node("other", "running");
  const html = render(React.createElement(SubagentTree, { nodes: [child, other], selectedSessionId: null, callbacks }));
  assert.match(html, /role="tree"/);
  assert.match(html, /role="treeitem"/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-posinset="1"/);
  assert.match(html, /aria-setsize="2"/);
  // Every disclosure is a real labeled button; the fake presentation span is gone.
  assert.match(html, /aria-label="Collapse"/);
  assert.doesNotMatch(html, /role="presentation"/);
});

test("composer source: error alert sits on its own line with shrink protection", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  // The alert is no longer a 100%-basis child of the input row.
  assert.doesNotMatch(source, /flex: "0 0 100%"/);
  assert.match(source, /role="alert"[\s\S]*?overflowWrap: "anywhere"/);
  // The composer wrapper, the input row, and the textarea all shrink instead of forcing overflow.
  assert.match(source, /flexDirection: "column",\s*gap: 8,[\s\S]*?borderTop: "1px solid var\(--border\)",[\s\S]*?minWidth: 0/);
  assert.match(source, /flex: "1 1 auto",\s*minWidth: 0,\s*minHeight: isMobile \? 44 : 34/);
});

test("tree source: ArrowLeft uses ancestor navigation and disclosure is a real button", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  assert.match(source, /case "ArrowLeft":[\s\S]*?parent/);
  assert.doesNotMatch(source, /case "ArrowLeft":[\s\S]*?index - 1/);
  assert.match(source, /aria-label=\{.*subagents\.(expand|collapse)/);
  assert.doesNotMatch(source, /role="presentation"/);
});

test("tree source: roving focus skips disabled placeholder rows", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  assert.match(source, /function nextFocusableIndex\(rows: TreeRow\[\], from: number, direction: 1 \| -1\)/);
  assert.match(source, /target && !target\.disabled/);
  assert.match(source, /nextFocusableIndex\(visibleRows, focusIndex, 1\)/);
  // Movement keys resolve placeholder candidates direction-aware instead of
  // swallowing keys when no forward focusable row exists.
  assert.match(source, /case "ArrowUp":[\s\S]*?nextFocusableIndex\(visibleRows, [^)]*?, -1\)/);
  assert.match(source, /case "ArrowDown":[\s\S]*?nextFocusableIndex\(visibleRows, [^)]*?, 1\)/);
});

test("tree source: focus restore is guarded so refreshes never steal the composer cursor", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  // Roving-focus restore only runs while the tree itself holds focus; a
  // background data refresh must not yank the cursor out of the composer.
  assert.match(source, /containerRef\.current\?\.ownerDocument\.activeElement/);
  assert.match(source, /!containerRef\.current\.contains\(active\)/);
  // The passive desktop card never auto-focuses on mount; only the popover
  // opts in via initialFocus.
  assert.match(source, /initialFocus = false/);
  assert.match(source, /focusedOnceRef\.current \|\| visibleRows\.length === 0/);
  assert.match(source, /if \(!initialFocus \|\| focusedOnceRef\.current/);
});

test("tree source: clicking a row keeps the roving index in sync", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => \{ if \(!disabled\) \{ setFocusIndex\(index\); callbacks\.onSelect\(node\); \} \}\}/);
});

test("nextFocusableIndex skips placeholders in both directions", () => {
  const rows = [
    { node: { sessionId: "a" } },
    { node: { sessionId: null } },   // placeholder
    { node: { sessionId: null } },   // placeholder
    { node: { sessionId: "b" } },
  ];
  assert.equal(nextFocusableIndex(rows, 0, 1), 0);
  assert.equal(nextFocusableIndex(rows, 1, 1), 3);
  assert.equal(nextFocusableIndex(rows, 2, 1), 3);
  // From a focusable row the row itself wins; backward skips both placeholders
  // when starting on one (rows 1 and 2).
  assert.equal(nextFocusableIndex(rows, 3, -1), 3);
  assert.equal(nextFocusableIndex(rows, 1, -1), 0);
  assert.equal(nextFocusableIndex(rows, 2, -1), 0);
  assert.equal(nextFocusableIndex(rows, 3, 1), 3);
  assert.equal(nextFocusableIndex([{ node: { sessionId: null } }], 0, 1), -1);
});

test("breadcrumb root uses the real root session id", () => {
  const items = buildBreadcrumbItems(
    [node("child", "running")],
    "child",
    "root-session-id",
    "Main task",
  );
  assert.equal(items[0].id, "root-session-id");
  assert.equal(items[0].label, "Main task");
  assert.equal(items.length, 2);
  assert.equal(items[1].id, "child");
});

test("breadcrumb falls back to the agent role when the durable task is empty", () => {
  const items = buildBreadcrumbItems(
    [node("child", "inactive", { agent: "worker", task: "" })],
    "child",
    "root-session-id",
    "Main task",
  );
  assert.equal(items[1].label, "worker");
});

test("breadcrumb renders root and every ancestor as buttons with the current as text", () => {
  const items = [
    { id: "root", label: "Main task" },
    { id: "child", label: "task child" },
    { id: "grand", label: "task grand" },
  ];
  const html = render(React.createElement(SessionBreadcrumb, { items, onSelect: noop }));
  assert.match(html, /aria-label="Subagent breadcrumb"/);
  assert.match(html, /Main task/);
  assert.match(html, /task child/);
  assert.match(html, /task grand/);
  const buttons = html.match(/<button/g);
  assert.equal(buttons?.length, 2);
  assert.equal(render(React.createElement(SessionBreadcrumb, { items: [], onSelect: noop })), "");
});

test("running composer exposes steer submit and soft interrupt without a stop", () => {
  const html = render(React.createElement(SubagentComposer, {
    node: node("child", "running"),
    rpcAvailable: true,
    onControl: async () => {},
    onInterrupt: async () => {},
  }));
  assert.match(html, /aria-label="Pause this subagent \(resumable\)"/);
  assert.match(html, /aria-label="Steer"/);
  assert.match(html, /Send a steering message/);
  assert.doesNotMatch(html, /aria-label="Stop"/);
});

test("paused composer submits resume and has no interrupt button", () => {
  const html = render(React.createElement(SubagentComposer, {
    node: node("child", "paused"),
    rpcAvailable: true,
    onControl: async () => {},
    onInterrupt: async () => {},
  }));
  assert.match(html, /aria-label="Resume"/);
  assert.doesNotMatch(html, /Pause this subagent/);
  assert.doesNotMatch(html, /Send a steering message/);
  assert.match(html, /Continue with a message/);
});

test("terminal, inactive, placeholder, and unavailable modes are read-only", () => {
  for (const state of ["complete", "stopped", "failed", "rejected", "inactive"]) {
    const html = render(React.createElement(SubagentComposer, {
      node: node("child", state),
      rpcAvailable: true,
      onControl: async () => {},
      onInterrupt: async () => {},
    }));
    assert.match(html, /Live controls are unavailable/, state);
    assert.doesNotMatch(html, /<textarea/, state);
  }
  const placeholderHtml = render(React.createElement(SubagentComposer, {
    node: node(null, "starting"),
    rpcAvailable: true,
    onControl: async () => {},
    onInterrupt: async () => {},
  }));
  assert.match(placeholderHtml, /Live controls are unavailable/);
  const offlineHtml = render(React.createElement(SubagentComposer, {
    node: node("child", "running"),
    rpcAvailable: false,
    onControl: async () => {},
    onInterrupt: async () => {},
  }));
  assert.match(offlineHtml, /Live controls are unavailable/);
});

test("desktop subagent card renders summary, stale state, and recursive rows", () => {
  const child = node("reviewer", "running", {
    agent: "reviewer",
    task: "Review the current implementation",
    activity: "reading files",
    elapsedMs: 83_000,
    children: [node("analyst", "paused", { agent: "analyst", task: "Check edge cases" })],
  });
  const finished = node("finished", "complete", { agent: "worker", task: "Update tests" });
  const html = render(React.createElement(DesktopSubagentCard, {
    nodes: [child, finished],
    selectedSessionId: "reviewer",
    rpcAvailable: true,
    stale: true,
    callbacks,
  }));

  assert.match(html, /aria-label="Subagents"/);
  // The card owns the count on wide desktop; the header badge is gone.
  assert.match(html, /3 Subagents/);
  assert.match(html, /1 running/);
  assert.match(html, /Live status is stale/);
  assert.match(html, /Review the current implementation/);
  assert.match(html, /reading files/);
  assert.match(html, /1m 23s/);
  assert.match(html, /Check edge cases/);
  assert.match(html, /aria-current="true"/);
  assert.equal(countActiveSubagentNodes([child, finished]), 1);
});

test("desktop card source: folds to its header when the task settles", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  // Settled tree → card collapses to the header; the header is a real toggle button.
  assert.match(source, /if \(settled\) setCollapsed\(true\);/);
  assert.match(source, /aria-expanded=\{!collapsed\}/);
  assert.match(source, /!collapsed \? \(\s*<SubagentTree/);
});

test("desktop subagent card shows the total count in its title", () => {
  // One top-level node with two nested children; the count lives here now that
  // the header badge is gone on wide desktop.
  const top = node("top", "running", {
    children: [
      node("mid", "running", { children: [node("leaf", "complete")] }),
    ],
  });
  const html = render(React.createElement(DesktopSubagentCard, {
    nodes: [top],
    selectedSessionId: null,
    rpcAvailable: true,
    stale: false,
    callbacks,
  }));
  assert.match(html, />3 Subagents<\/span>/);
});

test("desktop subagent card omits itself without nodes", () => {
  assert.equal(render(React.createElement(DesktopSubagentCard, {
    nodes: [],
    selectedSessionId: null,
    rpcAvailable: true,
    stale: false,
    callbacks,
  })), "");
});

test("desktop widget card relocates pi-subagents TUI output into the right gutter", () => {
  const html = render(React.createElement(DesktopSubagentWidgetCard, {
    widgets: [
      { key: "subagent-async", lines: ["\u001b[32mworker\u001b[0m reviewing"], placement: "aboveEditor" },
      { key: "subagent-fleet-status", lines: ["fleet 2"], placement: "belowEditor" },
    ],
  }));
  assert.match(html, /data-subagent-widget-card="true"/);
  assert.match(html, /aria-label="Subagents"/);
  assert.match(html, /worker reviewing/);
  assert.match(html, /fleet 2/);
  assert.doesNotMatch(html, /\u001b\[32m/);
});

test("running summary localizes in both locales", async () => {
  const { translateMessage } = await jiti.import("../lib/i18n/format.ts");
  const { getLocalePlugin } = await jiti.import("../lib/i18n/registry.ts");
  const messages = { en: getLocalePlugin("en").messages, "zh-CN": getLocalePlugin("zh-CN").messages };
  assert.equal(translateMessage("en", "subagents.runningSummary", messages, { count: 1 }), "1 running");
  assert.equal(translateMessage("zh-CN", "subagents.runningSummary", messages, { count: 1 }), "1 个运行中");
});

test("tree source: finished trees auto-collapse into a compact summary", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  // Settling the whole tree folds every branch with children; live trees stay as-is.
  // The live check reuses the shared hasActiveDescendant walk instead of a local copy.
  assert.match(source, /hasActiveDescendant\(nodes\)\) return;[\s\S]*?setCollapsed/);
  assert.match(source, /node\.children\.length > 0[\s\S]*?next\.add\(nodeId\(node\)\)/);
  assert.doesNotMatch(source, /function hasLiveNode/);
});

test("pure helpers: submit action, elapsed formatting, and visible node flattening", () => {
  assert.equal(submitActionFor(node("a", "running")), "steer");
  assert.equal(submitActionFor(node("a", "queued")), "steer");
  assert.equal(submitActionFor(node("a", "needs_attention")), "steer");
  assert.equal(submitActionFor(node("a", "paused")), "resume");
  assert.equal(submitActionFor(node("a", "complete")), null);
  assert.equal(submitActionFor(node(null, "starting")), null);

  assert.equal(formatElapsed(0), "0s");
  assert.equal(formatElapsed(83_000), "1m 23s");
  assert.equal(formatElapsed(3_700_000), "1h 1m");
  assert.equal(formatElapsed(-1), "");

  const child = node("child", "running", { children: [node("grand", "inactive")] });
  assert.deepEqual(getVisibleNodes([child], new Set()).map((n) => n.sessionId), ["child", "grand"]);
  assert.deepEqual(getVisibleNodes([child], new Set(["child"])).map((n) => n.sessionId), ["child"]);
});

test("subagent rows expose a stable session selector for browser probes", () => {
  const source = readFileSync(new URL("./SubagentSessions.tsx", import.meta.url), "utf8");
  assert.match(source, /data-subagent-session-id=\{node\.sessionId \?\? undefined\}/);
  assert.match(source, /data-subagent-card-row="true"[\s\S]*?data-subagent-session-id=\{node\.sessionId \?\? undefined\}/);
});
