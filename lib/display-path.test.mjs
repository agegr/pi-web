import assert from "node:assert/strict";
import test from "node:test";
import { displayPathWithin, shortenPath } from "./display-path.ts";

test("shows a macOS or Linux home folder as ~", () => {
  assert.equal(shortenPath("/Users/alex/repo/a.md"), "~/repo/a.md");
  assert.equal(shortenPath("/home/alex"), "~");
  assert.equal(shortenPath("/opt/repo"), "/opt/repo");
  // Only a leading home folder counts.
  assert.equal(shortenPath("/srv/Users/alex"), "/srv/Users/alex");
});

test("shows a path inside the root relative to it", () => {
  assert.equal(displayPathWithin("/Users/alex/repo/.pi/skills/a/SKILL.md", "/Users/alex/repo"), "./.pi/skills/a/SKILL.md");
  assert.equal(displayPathWithin("/Users/alex/repo/x", "/Users/alex/repo/"), "./x");
  assert.equal(displayPathWithin("C:\\repo\\x\\SKILL.md", "C:\\repo"), "./x\\SKILL.md");
});

test("a sibling folder that shares the root's prefix is not inside it", () => {
  assert.equal(displayPathWithin("/Users/alex/repo-other/x", "/Users/alex/repo"), "~/repo-other/x");
  assert.equal(displayPathWithin("/opt/elsewhere/x", "/Users/alex/repo"), "/opt/elsewhere/x");
  assert.equal(displayPathWithin("/Users/alex/x", ""), "~/x");
});
