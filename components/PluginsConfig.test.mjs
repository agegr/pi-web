import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");

test("PluginsConfig is Settings-only master-detail and keeps POST payloads", () => {
  assert.match(source, /onControllerChange\?\(controller: SettingsSectionController\)/);
  assert.match(source, /onControllerChange\?\.\(controller\)/);
  assert.doesNotMatch(source, /embedded = false/);
  assert.match(source, /<PluginsNavigator/);
  assert.match(source, /fetch\(`\/api\/plugins\?cwd=\$\{encodeURIComponent\(cwd\)\}`\)/);
  assert.match(source, /JSON\.stringify\(\{ action, source: pkg\.source, scope: pkg\.scope, cwd \}\)/);
  assert.match(source, /JSON\.stringify\(\{ action: "install", source, scope: installScope, cwd \}\)/);
  assert.match(source, /sendAgentCommand\(sessionId, \{ type: "reload" \}\)/);
});

test("PluginsConfig repairs selection by scope\\0source and returns to list when gone", () => {
  assert.match(source, /resolvePluginsSelection\(current, next\.packages\)/);
  assert.match(source, /pluginIdentity/);
  assert.match(source, /if \(current\) \{\s*setMobileView\("list"\)/);
  assert.match(source, /if \(addMode\) \{ setAddMode\(false\); return true; \}/);
});

test("PluginsConfig reloads the session after a successful runtime-affecting action", () => {
  assert.match(source, /setActionMessage\(messages\[action\]\);/);
  assert.match(source, /if \(sessionId\) \{[\s\S]*?sendAgentCommand\(sessionId, \{ type: "reload" \}\)/);
});
