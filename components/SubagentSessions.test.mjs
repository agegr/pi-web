import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const {
  SubagentHeaderAction,
  SubagentTree,
  SessionBreadcrumb,
  SubagentComposer,
  DesktopSubagentCard,
  countSubagentNodes,
  countActiveSubagentNodes,
  submitActionFor,
  formatElapsed,
  getVisibleNodes,
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

test("header action exposes accessible name, count, live marker, and pressed state", () => {
  const html = render(React.createElement(SubagentHeaderAction, { count: 3, open: true, live: true, onOpen: noop }));
  assert.match(html, /aria-label="Subagents \(3\)"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />3<\/span>/);
  assert.match(html, /border-radius:50%/);

  const idleHtml = render(React.createElement(SubagentHeaderAction, { count: 0, open: false, live: false, onOpen: noop }));
  assert.match(idleHtml, /aria-pressed="false"/);
  assert.doesNotMatch(idleHtml, /border-radius:50%/);
});

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

test("tree shows elapsed time when present and hides it otherwise", () => {
  const active = node("a", "running", { elapsedMs: 83_000 });
  const plain = node("b", "inactive");
  const html = render(React.createElement(SubagentTree, { nodes: [active, plain], selectedSessionId: null, callbacks }));
  assert.match(html, /1m 23s/);
  assert.doesNotMatch(html, /0s/);
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
  assert.match(html, /2 subagents/);
  assert.match(html, /1 running/);
  assert.match(html, /Live status is stale/);
  assert.match(html, /Review the current implementation/);
  assert.match(html, /reading files/);
  assert.match(html, /1m 23s/);
  assert.match(html, /Check edge cases/);
  assert.match(html, /aria-current="true"/);
  assert.equal(countActiveSubagentNodes([child, finished]), 1);
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
