import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatFirstTokenDuration } = await jiti.import("./first-token-format.ts");

test("formats sub-100ms first-token durations as milliseconds", () => {
  assert.equal(formatFirstTokenDuration(0.036), "36ms");
  assert.equal(formatFirstTokenDuration(0.1), "0.1s");
  assert.equal(formatFirstTokenDuration(2.34), "2.3s");
});
