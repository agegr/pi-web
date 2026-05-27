import test from "node:test";
import assert from "node:assert/strict";
async function loadRecentCwdsModule() {
  return import(new URL("../lib/recent-cwds.ts", import.meta.url).href);
}

test("buildRecentCwdOptions keeps stored-only projects removable without disturbing session projects", async () => {
  const { buildRecentCwdOptions } = await loadRecentCwdsModule();
  const result = buildRecentCwdOptions(
    ["C:/sessions/a", "C:/sessions/b"],
    ["C:/manual/x", "C:/sessions/a"],
  );

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), [
    { cwd: "C:/manual/x", source: "stored", removable: true },
    { cwd: "C:/sessions/a", source: "both", removable: false },
    { cwd: "C:/sessions/b", source: "session", removable: false },
  ]);
});

test("removeStoredRecentCwd forgets only the chosen manual project", async () => {
  const { removeStoredRecentCwd } = await loadRecentCwdsModule();
  const result = removeStoredRecentCwd(["C:/manual/x", "C:/manual/y"], "C:/manual/x");

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), ["C:/manual/y"]);
});
