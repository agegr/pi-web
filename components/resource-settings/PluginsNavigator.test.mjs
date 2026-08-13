import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PluginsNavigator.tsx", import.meta.url), "utf8");

test("plugins navigator uses labelled search, clear control, and native button rows", () => {
  assert.match(source, /aria-label=\{t\("resources\.searchPlugins"\)\}/);
  assert.match(source, /\{query && \(/);
  assert.match(source, /<button[\s\S]*?resource-settings-row/);
  assert.doesNotMatch(source, /onMouseEnter/);
});

test("plugins navigator labels project/global groups and uses stable identity", () => {
  assert.match(source, /t\("resources\.projectPackages"\)/);
  assert.match(source, /t\("resources\.globalPackages"\)/);
  assert.match(source, /pluginIdentity\(pkg\)/);
  assert.match(source, /data-selected=\{/);
  assert.match(source, /disabled=\{busy\}/);
});

test("plugins navigator stays controlled", () => {
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /useState/);
});
