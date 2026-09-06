import test from "node:test";
import assert from "node:assert/strict";
import { inlineWordDiff } from "./word-diff.ts";

test("marks only the changed word as removed/added", () => {
  const { left, right } = inlineWordDiff("const x = 1;", "const x = 2;");
  const leftText = left.map((s) => s.text).join("");
  const rightText = right.map((s) => s.text).join("");
  assert.equal(leftText, "const x = 1;");
  assert.equal(rightText, "const x = 2;");
  assert.ok(left.some((s) => s.type === "removed" && s.text === "1"));
  assert.ok(right.some((s) => s.type === "added" && s.text === "2"));
});

test("fully identical lines are all common", () => {
  const { left, right } = inlineWordDiff("abc def", "abc def");
  assert.ok(left.every((s) => s.type === "common"));
  assert.ok(right.every((s) => s.type === "common"));
});

test("fully different lines are all removed/added", () => {
  const { left, right } = inlineWordDiff("foo", "bar baz");
  assert.ok(left.every((s) => s.type === "removed"));
  assert.ok(right.every((s) => s.type === "added"));
});

test("keeps concatenated text equal to the original lines", () => {
  const a = "function f(a) { return a + 1; }";
  const b = "function f(a, b) { return a + b; }";
  const { left, right } = inlineWordDiff(a, b);
  assert.equal(left.map((s) => s.text).join(""), a);
  assert.equal(right.map((s) => s.text).join(""), b);
});

test("does not paint whitespace-only changes", () => {
  const { left, right } = inlineWordDiff("x = 1", "  x = 1");
  assert.ok(left.filter((s) => s.type === "removed").every((s) => !/^\s+$/.test(s.text) || false));
  assert.ok(right.filter((s) => s.type === "added").every((s) => !/^\s+$/.test(s.text) || false));
});
