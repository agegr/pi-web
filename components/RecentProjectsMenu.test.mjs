import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import { readFile } from "node:fs/promises";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { RecentProjectsMenu } = await jiti.import("./RecentProjectsMenu.tsx");

const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

// Translation stub: returns the key so a raw-key leak is detectable in the
// rendered output (every visible label goes through `t`).
const t = (key) => key;

const projects = Array.from({ length: 9 }, (_, index) => ({
  key: `project-${index}`,
  root: `/work/project-${index}`,
}));

function renderMenu() {
  return renderToStaticMarkup(React.createElement(RecentProjectsMenu, {
    t,
    projects,
    selectedKey: "project-3",
    homeDir: "/home/user",
    showDefaultCwdShortcut: true,
    customPathOpen: false,
    onSelectProject: () => {},
    onTogglePin: () => {},
    onUseDefaultCwd: () => {},
    onCustomPathClick: () => {},
  }));
}

test("with more than 8 projects every row renders and there is NO filter input", () => {
  const markup = renderMenu();
  // Every recent project row is present, unfiltered.
  for (const project of projects) {
    assert.ok(markup.includes(project.root), `row for ${project.root} must render`);
  }
  // The filter box is gone: no input element at all in the dropdown body.
  assert.doesNotMatch(markup, /<input/);
  // The shortcuts survive the extraction.
  assert.match(markup, /sidebar\.useDefaultDirectory/);
  assert.match(markup, /sidebar\.customPath/);
  // Pin toggles keep working per row.
  // One pin toggle per row (title attribute carries the echoed key once).
  assert.equal((markup.match(/title="sidebar\.pinProject"/g) ?? []).length, projects.length);
});

test("no raw i18n key leaks into rendered strings and no filter key is referenced", () => {
  const markup = renderMenu();
  // Keys rendered through t() are expected (the stub echoes them); the
  // retired filter keys must not appear anywhere.
  assert.doesNotMatch(markup, /sidebar\.filterProjects/);
  assert.doesNotMatch(markup, /sidebar\.noMatchingProjects/);
});

test("SessionSidebar no longer carries the filter state, gate, input or hint", () => {
  assert.doesNotMatch(sidebarSource, /projectFilter/);
  assert.doesNotMatch(sidebarSource, /showProjectFilter/);
  assert.doesNotMatch(sidebarSource, /sidebar\.filterProjects/);
  assert.doesNotMatch(sidebarSource, /sidebar\.noMatchingProjects/);
  // The dropdown body is delegated to the extracted menu.
  assert.match(sidebarSource, /<RecentProjectsMenu/);
  assert.match(sidebarSource, /projects=\{recentUnpinnedProjects\}/);
});

test("the retired filter keys are gone from all three locales", async () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(messages, /sidebar\.filterProjects/);
    assert.doesNotMatch(messages, /sidebar\.noMatchingProjects/);
  }
});
