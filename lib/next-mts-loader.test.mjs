import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const loader = require("../scripts/next-mts-loader.cjs");

test("production webpack loader strips types while preserving ESM", () => {
  const output = loader.call(
    { resourcePath: "/tmp/session-index-worker.mts" },
    'import type { Stats } from "node:fs";\nexport const value: number = 1;\n',
  );
  assert.doesNotMatch(output, /import type|: number/);
  assert.match(output, /export const value = 1/);
});
