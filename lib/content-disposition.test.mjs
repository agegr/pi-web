import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { contentDisposition } = await createJiti(import.meta.url).import("./content-disposition.ts");

test("the ASCII filename replaces what would break the quoted string", () => {
  assert.equal(
    contentDisposition("attachment", 'a\\b"c;.txt', "download"),
    "attachment; filename=\"a_b_c_.txt\"; filename*=UTF-8''a%5Cb%22c%3B.txt",
  );
  assert.equal(contentDisposition("inline", "trail\\", "download"), "inline; filename=\"trail_\"; filename*=UTF-8''trail%5C");
});

test("a name with nothing printable falls back; filename* keeps it exactly", () => {
  assert.equal(contentDisposition("attachment", "", "download"), "attachment; filename=\"download\"; filename*=UTF-8''");
  assert.equal(
    contentDisposition("inline", "报告 (1).md", "download"),
    "inline; filename=\"__ (1).md\"; filename*=UTF-8''%E6%8A%A5%E5%91%8A%20%281%29.md",
  );
});
