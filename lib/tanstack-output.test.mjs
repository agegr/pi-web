import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const startSource = await readFile(new URL("../scripts/start-tanstack-output.mjs", import.meta.url), "utf8");
const verifySource = await readFile(new URL("../scripts/verify-tanstack-output.mjs", import.meta.url), "utf8");
const smokeSource = await readFile(new URL("../scripts/smoke-tanstack-output.mjs", import.meta.url), "utf8");

test("output tools require an explicit absolute build path", () => {
  for (const source of [startSource, verifySource, smokeSource]) {
    assert.match(source, /PI_WEB_TANSTACK_OUTPUT_DIR/);
    assert.match(source, /isAbsolute/);
  }
});

test("smoke test uses structured spawn and probes both required endpoints", () => {
  assert.match(smokeSource, /spawn\(process\.execPath, \[serverEntry\]/);
  assert.match(smokeSource, /waitFor\(`\$\{origin\}\/`\)/);
  assert.match(smokeSource, /fetch\(`\$\{origin\}\/api\/sessions`\)/);
  assert.match(smokeSource, /fetch\(url\)/);
  assert.doesNotMatch(smokeSource, /shell:\s*true/);
});

const workflow = await readFile(new URL("../.github/workflows/tanstack-spike-windows.yml", import.meta.url), "utf8");

test("Windows gate builds and runs the generated server on Windows", () => {
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node-version: 22\.19\.0/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run build:tanstack/);
  assert.match(workflow, /verify-tanstack-output\.mjs/);
  assert.match(workflow, /smoke-tanstack-output\.mjs/);
});
