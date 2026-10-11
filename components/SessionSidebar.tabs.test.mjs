import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// The tabs layout's markup (the desktop setting's other choice; phones),
// rendered. useFilesPlacement's server snapshot is always "below", so the
// hook is aliased to a fixture that answers "tab". The alias takes the
// module's absolute path without its extension ("@/…" resolves first and is
// never matched), and it needs a process of its own: SessionSidebar.test.mjs
// has already loaded the sidebar with the real hook, and jiti shares Node's
// module cache.
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
  alias: {
    [fileURLToPath(new URL("../hooks/useFilesPlacement", import.meta.url))]: fileURLToPath(new URL("./__fixtures__/files-placement-tab.mjs", import.meta.url)),
  },
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n.tsx");
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");

const h = React.createElement;
const noop = () => {};

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SessionSidebar, {
    selectedSessionId: null,
    onSelectSession: noop,
    ...props,
  })));
}

/** The files tab's row of keys under the picker. */
function actionsRow(html) {
  const start = html.indexOf('<div class="sidebar-files-actions"');
  assert.notEqual(start, -1, "the files tab's keys are rendered");
  return html.slice(start, html.indexOf("</div>", start) + "</div>".length);
}

/** Each key's name and state, in order (as SessionSidebar.test.mjs reads the stacked row's). */
function keyLabels(markup) {
  return [...markup.matchAll(/<button type="button"( disabled="")? title="([^"]+)" aria-label="\2"( aria-pressed="(true|false)")?( aria-expanded="(true|false)" aria-controls="[^"]+")? class="[^"]+"/g)]
    .map((match) => `${match[2]}${match[1] ? " (disabled)" : ""}${match[4] ? ` pressed=${match[4]}` : ""}${match[6] ? ` expanded=${match[6]}` : ""}`);
}

test("the fixture stands in for the whole hook module", async () => {
  // Everything the real module exports, so no importer of it breaks under the alias.
  const hookSource = await readFile(new URL("../hooks/useFilesPlacement.ts", import.meta.url), "utf8");
  const fixture = await import("./__fixtures__/files-placement-tab.mjs");
  const exported = [...hookSource.matchAll(/^export (?:const|function) (\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(Object.keys(fixture).sort(), exported.sort());
  assert.equal(fixture.useFilesPlacement(), "tab");
});

test("the tabs layout renders its tabs, no brand and no files section header", () => {
  const html = render({ selectedCwd: "/work/alpha", onOpenTerminal: noop });
  assert.match(html, /^<div class="session-sidebar" style="--sidebar-files-height:320px"><div class="sidebar-header"><div class="sidebar-tabs-list" role="tablist" aria-label="Sidebar view">/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /sidebar-brand|sidebar-files-section|sidebar-files-keys|sidebar-files-changes|is-files-below/);
  // Both panels are tab panels; the files' is hidden behind its tab.
  assert.match(html, /<div id="session-sidebar-panel-files" role="tabpanel" aria-labelledby="session-sidebar-tab-files" hidden="" class="sidebar-panel sidebar-files-panel">/);
  // The picker's two boxes one under the other, then the keys.
  assert.match(html, /<div class="sidebar-files-head"><div class="project-picker is-stacked" role="group"/);
  // No file search key: the toolbar row's search is the tab's.
  assert.doesNotMatch(html, /aria-controls="file-search-input"/);
});

test("the files tab's keys: the folder's four, then the tree's two views, always the same", () => {
  const row = actionsRow(render({ selectedCwd: "/work/alpha", onOpenTerminal: noop }));
  assert.match(row, /^<div class="sidebar-files-actions" role="group" aria-label="File actions">/);
  // The changes view is there without changes too, disabled, and its count
  // is the tab's.
  assert.deepEqual(keyLabels(row), [
    "Open workspace terminal",
    "Open in file manager",
    "Upload files to project root",
    "Refresh file list",
    "Show ignored files pressed=false",
    "0 changed files (disabled) pressed=false",
  ]);
  // The tree's views start at the right end.
  assert.match(row, /title="Show ignored files" aria-label="Show ignored files" aria-pressed="false" class="sidebar-tool-button sidebar-files-views-start"/);
  assert.equal((row.match(/sidebar-files-views-start/g) ?? []).length, 1);
  // Their icons stay 14px here (the section header row's are 13px).
  assert.deepEqual([...row.matchAll(/<svg width="(\d+)" height="(\d+)"/g)].map((match) => `${match[1]}x${match[2]}`), Array(6).fill("14x14"));

  // Without a terminal (no onOpenTerminal) the other five stay; the files
  // tab leaves it out where the row below the sessions disables it.
  assert.deepEqual(keyLabels(actionsRow(render({ selectedCwd: "/work/alpha" }))), [
    "Open in file manager",
    "Upload files to project root",
    "Refresh file list",
    "Show ignored files pressed=false",
    "0 changed files (disabled) pressed=false",
  ]);

  // Without a folder there is nothing to act on: no row.
  assert.doesNotMatch(render(), /sidebar-files-actions/);
});
