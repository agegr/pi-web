import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildQuotedSelection } = await createJiti(import.meta.url).import("./quoted-selection.ts");

test("selected message text becomes a markdown quote", () => {
  assert.equal(
    buildQuotedSelection(" first line\nsecond line ", "About this passage:", "My question:"),
    "About this passage:\n\n> first line\n> second line\n\nMy question:",
  );
});
