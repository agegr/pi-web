import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("new-session startup sends only explicit browser overrides", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureNewSession"),
    source.indexOf("const loadSlashCommands"),
  );

  assert.match(ensureSource, /const selectedModel = newSessionModelOverrideRef\.current;/);
  assert.doesNotMatch(ensureSource, /newSessionModel \?\? newSessionDefaultModel/);
  assert.match(ensureSource, /const selectedThinkingLevel = thinkingLevelOverrideRef\.current;/);
  assert.doesNotMatch(ensureSource, /thinkingLevel !== "auto"/);
});

test("new-session startup adopts server state only while explicit overrides are unchanged", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureNewSession"),
    source.indexOf("const loadSlashCommands"),
  );

  assert.match(
    ensureSource,
    /result\.model && newSessionModelOverrideRef\.current === selectedModel/,
  );
  assert.match(ensureSource, /setPendingModel\(result\.model\)/);
  assert.match(ensureSource, /setNewSessionDefaultModel\(result\.model\)/);
  assert.match(
    ensureSource,
    /thinkingLevelOverrideRef\.current === selectedThinkingLevel/,
  );
  assert.match(ensureSource, /setThinkingLevel\(result\.thinkingLevel\)/);
});

test("model-list refresh does not overwrite a live session or explicit thinking override", () => {
  const loadModelsSource = source.slice(
    source.indexOf("const loadModels = useCallback"),
    source.indexOf("const handleBuiltinSlashCommand"),
  );

  assert.match(loadModelsSource, /if \(isNew && !sessionIdRef\.current\)/);
  assert.match(
    loadModelsSource,
    /thinkingLevelOverrideRef\.current === null/,
  );
  assert.match(loadModelsSource, /setThinkingLevel\(\(pinned[\s\S]*\?\? "auto"\)/);
});
