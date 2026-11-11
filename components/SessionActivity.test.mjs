import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { buildSessionActivityRows } = await jiti.import("@/lib/session-activity");
const { SessionActivity, activityRowOffsets } = await jiti.import("./SessionActivity.tsx");
const h = React.createElement;
const now = new Date(2026, 10, 3, 16);
const at = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
const session = (id, minutes = 0, extra = {}) => ({ id, path: `/work/${id}.jsonl`, cwd: "/work/project", projectRoot: "/work/project", projectKey: "/work/project", created: at(minutes), modified: at(minutes), messageCount: 2, firstMessage: id, ...extra });
const input = (sessions, extra = {}) => ({ sessions, uiState: { version: 1, revision: 0, sessions: {}, projects: {} }, runningIds: new Set(), awaitingIds: new Set(), unreadIds: new Set(), selectedSessionId: null, retainedUnreadRootId: null, now, ...extra });
const render = (rows, props = {}) => renderToStaticMarkup(h(I18nProvider, null, h(SessionActivity, { rows, layout: "desktop", loading: false, error: null, onSelect() {}, ...props })));

test("shows the priority heading, project, latest text and accessible status", () => {
  const rows = buildSessionActivityRows(input([
    session("working", 2, { name: "Working session", lastMessagePreview: "Finished <safe> text" }),
    session("waiting", 3),
  ], { runningIds: new Set(["working", "waiting"]), awaitingIds: new Set(["waiting"]), selectedSessionId: "working" }));
  const html = render(rows);
  assert.match(html, /activity-header:priority[^>]*>Priority/);
  assert.match(html, /href="\?session=working" aria-current="true"/);
  assert.match(html, /Working session/);
  assert.match(html, /Finished &lt;safe&gt; text/);
  assert.match(html, /Agent running/);
  assert.match(html, /Agent waiting for your input/);
  assert.match(html, /session-activity-project[^>]*>project/);
});

test("activity rows stay virtualized and have a separate mobile height", () => {
  const rows = buildSessionActivityRows(input(Array.from({ length: 1000 }, (_, i) => session(`s${i}`, i))));
  const html = render(rows);
  assert.ok((html.match(/class="session-tree-row session-activity-row/g) ?? []).length < 30);
  assert.equal(activityRowOffsets(rows, "desktop")[2] - activityRowOffsets(rows, "desktop")[1], 68);
  assert.equal(activityRowOffsets(rows, "mobile")[2] - activityRowOffsets(rows, "mobile")[1], 82);
});
