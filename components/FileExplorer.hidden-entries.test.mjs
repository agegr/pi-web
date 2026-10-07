import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { TreeNode } = await jiti.import("./FileExplorer.tsx");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const { translateMessage } = await jiti.import("@/lib/i18n/format.ts");

const t = (key, params) => translateMessage("en", key, { en: enLocale.messages }, params);

function renderNode(node, { open = false, parentHidden } = {}) {
  return renderToStaticMarkup(React.createElement(TreeNode, {
    node,
    depth: 0,
    cwd: "/repo",
    onOpenFile() {},
    expandedPaths: new Set(open ? [node.fullPath] : []),
    onToggleExpanded() {},
    highlightedPaths: new Set(),
    gitStatusByPath: new Map(),
    changedDirectoryPaths: new Set(),
    showHidden: true,
    parentHidden,
    t,
  }));
}

const file = (name, extra = {}) => ({
  name,
  fullPath: `/repo/${name}`,
  isDir: false,
  size: 0,
  loaded: true,
  ...extra,
});

test("an entry Git ignores is dimmed and says why", () => {
  const html = renderNode(file("debug.log", { hidden: "ignored" }));
  assert.match(html, /data-hidden-reason="ignored"/);
  assert.match(html, /opacity:0\.55/);
  assert.match(html, /title="\/repo\/debug\.log\nIgnored by Git"/);
});

test("an entry the fallback name list hides names that reason", () => {
  const html = renderNode(file("node_modules", { isDir: true, loaded: false, children: [], hidden: "excluded" }));
  assert.match(html, /data-hidden-reason="excluded"/);
  assert.match(html, /Hidden by default/);
});

test("entries inside a hidden directory inherit its reason", () => {
  const html = renderNode(file("index.js"), { parentHidden: "ignored" });
  assert.match(html, /data-hidden-reason="ignored"/);
});

test("an open hidden directory passes its reason to the entries it lists", () => {
  const html = renderNode({
    name: "out",
    fullPath: "/repo/out",
    isDir: true,
    size: 0,
    loaded: true,
    hidden: "ignored",
    children: [file("out/a.js", { name: "a.js", fullPath: "/repo/out/a.js" })],
  }, { open: true });
  assert.equal(html.match(/data-hidden-reason="ignored"/g)?.length, 2);
});

test("ordinary entries are not dimmed", () => {
  const html = renderNode(file("README.md"));
  assert.doesNotMatch(html, /data-hidden-reason/);
  assert.match(html, /title="\/repo\/README\.md"/);
});
