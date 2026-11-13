import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { AgentMiniStrip } = await jiti.import("./AgentMiniStrip.tsx");

function session(id, created, relation) {
  return { path: `/tmp/${id}.jsonl`, id, cwd: "/tmp", created, modified: created, messageCount: 1, firstMessage: id, ...(relation ? { relation } : {}) };
}

const root = session("main", "2026-01-01T00:00:00.000Z");
const members = [
  session("a", "2026-01-02T00:00:00.000Z", { kind: "subagent", parentSessionId: "main", profile: "explore", description: "Inspect", status: "completed" }),
  session("b", "2026-01-03T00:00:00.000Z", { kind: "subagent", parentSessionId: "main", profile: "plan", description: "Plan", status: "running" }),
  session("s", "2026-01-04T00:00:00.000Z", { kind: "side", parentSessionId: "main" }),
];

function render(selectedSessionId) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(AgentMiniStrip, {
    rootSession: root, members, selectedSessionId, runningSessionIds: new Set(["b"]), onSelectSession() {},
  })));
}

test("the Main agent chip sits outside the scrolling members, and only the current chip is a Tab stop", () => {
  const html = render("b");
  assert.match(html, /^<div role="toolbar" aria-label="Agents in this session"/);
  // Main agent comes before the scroller; the members are inside it.
  const scroller = html.indexOf('class="tabbar-scroll"');
  assert.ok(html.indexOf("Main agent") < scroller);
  assert.ok(html.indexOf(">Inspect<") > scroller && html.indexOf(">Side chat 1<") > scroller);

  const buttons = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);
  assert.equal(buttons.length, 4);
  assert.deepEqual(buttons.map((tag) => /tabindex="0"/.test(tag)), [false, false, true, false]);
  assert.deepEqual(buttons.map((tag) => /aria-current="true"/.test(tag)), [false, false, true, false]);
  // Colours are classes, so hover can change them.
  assert.ok(buttons.every((tag) => !/style="[^"]*(?:^|;)color:/.test(tag)));
  assert.match(buttons[1], /class="[^"]*text-text-muted[^"]*hover:text-text/);
});
