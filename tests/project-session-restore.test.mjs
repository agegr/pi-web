import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  return import(new URL("../lib/project-session-restore.ts", import.meta.url).href);
}

test("switching to a project restores that project's most recently modified session", async () => {
  const { pickSessionForCwd } = await loadModule();
  const sessions = [
    { id: "a-1", cwd: "/repo/a", modified: "2026-05-26T09:00:00.000Z" },
    { id: "a-2", cwd: "/repo/a", modified: "2026-05-26T10:00:00.000Z" },
    { id: "b-1", cwd: "/repo/b", modified: "2026-05-26T08:00:00.000Z" },
  ];

  const picked = pickSessionForCwd(sessions, "/repo/a");

  assert.deepStrictEqual(JSON.parse(JSON.stringify(picked)), sessions[1]);
});
