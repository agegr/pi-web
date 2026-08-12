import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

const { normalizeProjectPreferences } = await import("./project-registry-core.ts");

test("normalizes project metadata without changing project paths", () => {
  const projectPath = resolve("project-a");
  assert.deepEqual(normalizeProjectPreferences([{
    path: projectPath,
    name: "  Project A  ",
    pinned: true,
    archived: false,
    removed: false,
    order: 4,
  }]), [{
    path: projectPath,
    name: "Project A",
    pinned: true,
    archived: false,
    removed: false,
    order: 4,
  }]);
});

test("rejects duplicate and relative project paths", () => {
  const projectPath = resolve("project-a");
  assert.throws(() => normalizeProjectPreferences([{ path: "relative", order: 0 }]));
  assert.throws(() => normalizeProjectPreferences([
    { path: projectPath, order: 0 },
    { path: projectPath, order: 1 },
  ]));
});
