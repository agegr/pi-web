import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const {
  MAX_SESSION_REFERENCES,
  canAddSessionReference,
  referenceTitle,
  sessionReferenceToken,
  sessionReferenceTokens,
  withSessionReferences,
} = await jiti.import("./session-reference-target.ts");

const UUID = "01a1d03f-83b1-7311-b88e-4fa7a73ace2f";

test("a reference becomes the token the server expands", () => {
  assert.equal(
    sessionReferenceToken({ id: UUID, title: "修复登录" }),
    `[修复登录](#session:${UUID})`,
  );
});

test("brackets in the title never break the token", () => {
  const token = sessionReferenceToken({ id: UUID, title: "[草稿] 修复" });
  assert.equal(token, `[ 草稿  修复](#session:${UUID})`);
});

test("a session without a title uses the start of its id", () => {
  assert.equal(referenceTitle({ id: UUID, title: "  " }), UUID.slice(0, 8));
});

test("the message carries the user's text first, then the tokens", () => {
  const targets = [{ id: UUID, title: "甲" }, { id: "01a1d03f-83b1-7311-b88e-4fa7a73ace30", title: "乙" }];
  assert.equal(
    withSessionReferences("帮我看下这段\n", targets),
    `帮我看下这段\n\n[甲](#session:${UUID})\n[乙](#session:01a1d03f-83b1-7311-b88e-4fa7a73ace30)`,
  );
  // Only references: no leading blank line.
  assert.equal(withSessionReferences("", targets.slice(0, 1)), `[甲](#session:${UUID})`);
  // No references: the text is untouched, trailing newline included.
  assert.equal(withSessionReferences("原样\n", []), "原样\n");
});

test("the same session joins once, and the list has a cap", () => {
  assert.equal(canAddSessionReference([], UUID), true);
  assert.equal(canAddSessionReference([{ id: UUID, title: "甲" }], UUID), false);
  const full = Array.from({ length: MAX_SESSION_REFERENCES }, (_, index) => ({ id: `id-${index}`, title: `t${index}` }));
  assert.equal(canAddSessionReference(full, "another"), false);
});

test("every reference is one token per line", () => {
  assert.equal(
    sessionReferenceTokens([{ id: UUID, title: "甲" }, { id: UUID, title: "乙" }]),
    `[甲](#session:${UUID})\n[乙](#session:${UUID})`,
  );
});