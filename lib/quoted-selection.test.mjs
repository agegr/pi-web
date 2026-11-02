import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildQuotedSelection, quoteSeparator } = await createJiti(import.meta.url).import("./quoted-selection.ts");

test("selected message text becomes a markdown quote and a blank line", () => {
  assert.equal(
    buildQuotedSelection(" first line\nsecond line "),
    "> first line\n> second line\n\n",
  );
});

test("a quote inserted into a draft starts a paragraph of its own", () => {
  assert.equal(quoteSeparator(""), "");
  assert.equal(quoteSeparator("  "), "");
  assert.equal(quoteSeparator("> first\n\nreply\n\n"), "");
  assert.equal(quoteSeparator("> first\n\nreply\n"), "\n");
  assert.equal(quoteSeparator("> first\n\nreply"), "\n\n");
});
