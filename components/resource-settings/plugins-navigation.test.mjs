import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  filterPluginsNavigation,
  pluginIdentity,
  pluginsSelectionLabel,
  resolvePluginsSelection,
} = await jiti.import("./plugins-navigation.ts");

const packages = [
  { source: "npm:@pi/alpha", scope: "project", packageName: "alpha", status: "loaded", resources: [{ name: "alpha-skill" }] },
  { source: "npm:@pi/beta", scope: "global", packageName: "beta", status: "disabled", resources: [{ name: "beta-theme" }] },
  { source: "git:example/gamma", scope: "global", packageName: "gamma", status: "installed", resources: [] },
];

test("identity is scope plus source, never a filtered index", () => {
  assert.equal(pluginIdentity(packages[1]), "global\0npm:@pi/beta");
  assert.notEqual(pluginIdentity(packages[0]), pluginIdentity({ ...packages[0], scope: "global" }));
});

test("empty query restores project and global groups", () => {
  const result = filterPluginsNavigation(packages, "");
  assert.deepEqual(result.project.map((p) => p.source), ["npm:@pi/alpha"]);
  assert.deepEqual(result.global.map((p) => p.source), ["npm:@pi/beta", "git:example/gamma"]);
});

test("search matches source, package name, status, and child resource names", () => {
  assert.deepEqual(filterPluginsNavigation(packages, "ALPHA").project.map((p) => p.source), ["npm:@pi/alpha"]);
  assert.deepEqual(filterPluginsNavigation(packages, "disabled").global.map((p) => p.source), ["npm:@pi/beta"]);
  assert.deepEqual(filterPluginsNavigation(packages, "beta-theme").global.map((p) => p.source), ["npm:@pi/beta"]);
});

test("a resource-only match keeps the parent package", () => {
  const result = filterPluginsNavigation(packages, "alpha-skill");
  assert.equal(result.project.length, 1);
  assert.equal(result.project[0].source, "npm:@pi/alpha");
  assert.equal(result.global.length, 0);
});

test("selection falls back to list after removal or refresh", () => {
  assert.equal(resolvePluginsSelection("project\0npm:@pi/alpha", packages), "project\0npm:@pi/alpha");
  assert.equal(resolvePluginsSelection("global\0missing", packages), null);
  assert.equal(resolvePluginsSelection(null, packages), null);
});

test("selection labels name the package and its scope", () => {
  assert.deepEqual(pluginsSelectionLabel("global\0npm:@pi/beta", packages), {
    title: "beta",
    subtitle: "global",
  });
  assert.deepEqual(pluginsSelectionLabel("gone", packages), { title: "" });
});
