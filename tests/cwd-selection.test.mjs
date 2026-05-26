import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";

async function loadCwdSelectionModule() {
  const source = await readFile(new URL("../lib/cwd-selection.ts", import.meta.url), "utf8");
  const transformed = source
    .replace(/export interface[\s\S]*?\n}\n/g, "")
    .replace(/export type[\s\S]*?;\n/g, "")
    .replace(
      /export async function selectCwdWithValidation\([\s\S]*?\): Promise<SelectCwdResult> \{/,
      "async function selectCwdWithValidation(candidatePath, validatePath) {",
    )
    .concat("\nmodule.exports = { selectCwdWithValidation };\n");

  const context = createContext({ module: { exports: {} }, exports: {} });
  new Script(transformed, { filename: "cwd-selection.test.js" }).runInContext(context);
  return context.module.exports;
}

test("selectCwdWithValidation accepts a validated absolute path", async () => {
  const { selectCwdWithValidation } = await loadCwdSelectionModule();
  const result = await selectCwdWithValidation("C:\\work\\pi-web", async (path) => ({
    path,
    valid: true,
  }));

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    cwd: "C:\\work\\pi-web",
  });
});

test("selectCwdWithValidation rejects an invalid browse result without changing cwd", async () => {
  const { selectCwdWithValidation } = await loadCwdSelectionModule();
  const result = await selectCwdWithValidation("missing-folder", async () => ({
    path: "C:\\Users\\Administrator",
    valid: false,
    error: "Directory does not exist: missing-folder",
  }));

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
    ok: false,
    error: "Directory does not exist: missing-folder",
    fallbackPath: "C:\\Users\\Administrator",
  });
});
