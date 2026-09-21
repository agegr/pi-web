import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject(path) {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  } catch {
    return import(path);
  }
}

const { planModelSync } = await loadSubject("./model-sync.ts");

test("splits upstream models into additions and reported stale ids", () => {
  const plan = planModelSync(["deepseek-flash", "deepseek-legacy-x"], [
    { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
  ]);

  assert.deepEqual(plan, {
    additions: [{ id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" }],
    stale: ["deepseek-legacy-x"],
  });
});

test("keeps upstream and configured order, not sorted order", () => {
  const plan = planModelSync(["z-local", "a-local"], [
    { id: "z-upstream" },
    { id: "a-upstream" },
  ]);

  assert.deepEqual(plan.additions.map((model) => model.id), ["z-upstream", "a-upstream"]);
  assert.deepEqual(plan.stale, ["z-local", "a-local"]);
});

test("ignores duplicates and blank ids on both sides", () => {
  const plan = planModelSync(["", "dup", "dup", ""], [
    { id: "" },
    { id: "dup" },
    { id: "dup" },
    { id: "fresh" },
  ]);

  assert.deepEqual(plan, { additions: [{ id: "fresh" }], stale: [] });
});

test("treats model ids as case-sensitive opaque strings", () => {
  const plan = planModelSync(["DeepSeek-V4"], [{ id: "deepseek-v4" }]);

  assert.deepEqual(plan.additions, [{ id: "deepseek-v4" }]);
  assert.deepEqual(plan.stale, ["DeepSeek-V4"]);
});

test("reports every configured model when upstream offers nothing", () => {
  const plan = planModelSync(["a", "b"], []);

  assert.deepEqual(plan, { additions: [], stale: ["a", "b"] });
});

test("reports nothing to do when config and upstream already match", () => {
  const plan = planModelSync(["a", "b"], [{ id: "b" }, { id: "a" }]);

  assert.deepEqual(plan, { additions: [], stale: [] });
});
