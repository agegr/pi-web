import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatFrontmatterValue,
  getFrontmatterTitle,
  parseFrontmatter,
} from "./frontmatter.ts";

describe("parseFrontmatter", () => {
  it("accepts the same common fence variants as remark-frontmatter", () => {
    const cases = [
      "---\ntitle: Demo\n---\nbody",
      "\uFEFF---\ntitle: Demo\n---\nbody",
      "---   \ntitle: Demo\n---\t\nbody",
      "---\r\ntitle: Demo\r\n---\r\nbody",
      "---\rtitle: Demo\r---\rbody",
    ];

    for (const markdown of cases) {
      assert.deepEqual(parseFrontmatter(markdown), {
        data: { title: "Demo" },
        rest: "body",
      });
    }
  });

  it("removes an empty or malformed fenced block from the returned body", () => {
    assert.deepEqual(parseFrontmatter("---\n---\nbody"), { data: null, rest: "body" });
    assert.deepEqual(parseFrontmatter("---\n[invalid\n---\nbody"), {
      data: null,
      rest: "body",
    });
  });

  it("leaves documents without a leading frontmatter block untouched", () => {
    const markdown = "body\n---\ntitle: Not frontmatter\n---";
    assert.deepEqual(parseFrontmatter(markdown), { data: null, rest: markdown });
  });
});

describe("frontmatter value formatting", () => {
  it("does not recurse forever through YAML aliases", () => {
    const { data } = parseFrontmatter("---\nloop: &loop\n  - *loop\n---\n");
    assert.ok(data);
    assert.equal(formatFrontmatterValue(data.loop), "[Circular]");
  });

  it("uses scalar titles and leaves structured titles for the metadata rows", () => {
    assert.equal(getFrontmatterTitle("  Demo  "), "Demo");
    assert.equal(getFrontmatterTitle(1984), "1984");
    assert.equal(getFrontmatterTitle(false), "false");
    assert.equal(getFrontmatterTitle(["Demo"]), null);
  });
});
