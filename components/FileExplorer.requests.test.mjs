import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

function effectBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} not found`);
  assert.notEqual(end, -1, `${endMarker} not found`);
  return source.slice(start, end);
}

test("root directory requests are abortable and generation guarded", () => {
  assert.match(source, /async function fetchEntries\(dirPath: string, signal\?: AbortSignal\)/);
  assert.match(source, /fetch\(`\/api\/files\/\$\{encoded\}\?type=list`, \{ signal \}\)/);

  const effect = effectBetween(
    "const cwdChanged = prevCwdRef.current !== cwd",
    "useEffect(() => {\n    if (directoryValidationCwdRef.current !== cwd)",
  );
  assert.match(effect, /const requestId = \+\+rootRequestRef\.current/);
  assert.match(effect, /fetchEntries\(cwd, controller\.signal\)/);
  assert.match(effect, /requestId === rootRequestRef\.current/);
  assert.match(effect, /return \(\) => controller\.abort\(\)/);
});

test("Git status requests are abortable and generation guarded", () => {
  assert.match(source, /async function fetchGitStatus\([\s\S]*?cwd: string,[\s\S]*?signal\?: AbortSignal,[\s\S]*?force = false/);
  assert.match(source, /fetch\(`\/api\/git\/status\?\$\{params\.toString\(\)\}`, \{ signal \}\)/);

  const effect = effectBetween(
    "useEffect(() => {\n    const requestId = ++gitRequestRef.current",
    "useEffect(() => {\n    onChangesCountChange",
  );
  assert.match(effect, /fetchGitStatus\(cwd, controller\.signal, force\)/);
  assert.match(effect, /requestId !== gitRequestRef\.current/);
  assert.match(effect, /return \(\) => controller\.abort\(\)/);
});

test("expanded directories use one bounded version batch and re-enumerate only changed paths", () => {
  assert.match(source, /type=directory-versions/);
  assert.match(source, /offset \+= DIRECTORY_VERSION_BATCH_SIZE/);
  assert.match(source, /body: JSON\.stringify\(\{ paths: batch \}\)/);
  const validation = effectBetween(
    "useEffect(() => {\n    if (directoryValidationCwdRef.current !== cwd)",
    "useEffect(() => {\n    const requestId = ++gitRequestRef.current",
  );
  assert.match(validation, /if \(forceRefresh\)[\s\S]*?setDirectoryRefreshVersions/);
  assert.match(validation, /fetchDirectoryVersions\(cwd, paths, controller\.signal\)/);
  assert.match(validation, /previous !== undefined && previous !== next/);
  assert.match(validation, /setDirectoryRefreshVersions/);
  assert.match(source, /MAX_DIRECTORY_VERSION_CACHE_ENTRIES = 512/);

  const treeRefresh = effectBetween(
    "// Re-enumerate only directories whose metadata version changed",
    "const handleClick = useCallback",
  );
  assert.match(treeRefresh, /\[refreshVersion\]/);
  assert.doesNotMatch(treeRefresh, /refreshToken/);
});
