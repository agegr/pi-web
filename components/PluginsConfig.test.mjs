import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { filteredPackagesKeptOn, packagesToSwitch } = await jiti.import("./PluginsConfig.tsx");

const packages = [
  { source: "npm:global-on", scope: "global", disabled: false, filtered: false },
  { source: "npm:global-off", scope: "global", disabled: true, filtered: true },
  { source: "npm:project-on", scope: "project", disabled: false, filtered: false },
];

test("a group switch targets the packages that would change", () => {
  assert.deepEqual(packagesToSwitch(packages, true).map((pkg) => pkg.source), ["npm:global-off"]);
  assert.deepEqual(packagesToSwitch(packages, false).map((pkg) => pkg.source), ["npm:global-on", "npm:project-on"]);
  assert.deepEqual(packagesToSwitch(packages.filter((pkg) => !pkg.disabled), true), []);
});

test("switching a group off leaves an enabled filtered package on and says so", () => {
  // Disabling empties its resource lists, and nothing would bring the filters back.
  const withFiltered = [...packages, { source: "npm:filtered-on", scope: "global", disabled: false, filtered: true }];
  assert.deepEqual(packagesToSwitch(withFiltered, false).map((pkg) => pkg.source), ["npm:global-on", "npm:project-on"]);
  assert.deepEqual(filteredPackagesKeptOn(withFiltered).map((pkg) => pkg.source), ["npm:filtered-on"]);
  assert.match(source, /const note = keptOn > 0 \? t\("plugins\.bulkKeptFiltered", \{ count: keptOn \}\) : undefined;/);
  // Even when only filtered packages are on and nothing is sent, the note shows.
  assert.match(source, /setGroupStatus\(note \? \{ scope, note \} : null\);\s+if \(targets\.length === 0\) return;/);
});

test("a group switch sends one request for its scope's packages", () => {
  assert.match(source, /packages: targets\.map\(\(\{ source \}\) => \(\{ source, scope \}\)\)/);
  assert.match(source, /setBusyKey\(`bulk:\$\{scope\}`\)/);
  // The open package's controls wait for the bulk run like for their own action.
  assert.match(source, /const busy = \(busyKey\?\.endsWith\(key\) \|\| busyKey\?\.startsWith\("bulk:"\)\) \?\? false;/);
  assert.match(source, /disabled=\{footerBusy\}\s+loading=\{busyKey === `bulk:\$\{group\.scope\}`\}/);
});

test("a bulk run confirms like the package switch and asks for a reload in an open session", () => {
  assert.match(source, /setActionMessage\(sessionId \? `\$\{message\} \$\{t\("agents\.reloadRequired"\)\}` : message\)/);
  assert.match(source, /t\("plugins\.bulkFailed", \{ count: failures\.length, total: results\.length \}\)/);
});
