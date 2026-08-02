import assert from "node:assert/strict";
import test from "node:test";

const { compressOffline } = await import("./compress.ts");

test("compressOffline is deterministic", () => {
  const text = "请保持专业语气。\n请保持专业语气。\n\n\n输出要简洁。";
  assert.equal(compressOffline(text).text, compressOffline(text).text);
});

test("compressOffline never increases length and ratio within [0,1]", () => {
  const text = "A\nB\nC\n".repeat(5);
  const r = compressOffline(text);
  assert.ok(r.charsAfter <= r.charsBefore, "compressed <= original");
  assert.ok(r.ratio >= 0 && r.ratio <= 1, "ratio in [0,1]");
  assert.equal(r.usedLlm, false);
});

test("compressOffline removes duplicate lines", () => {
  const text = ["line one", "line two", "line one", "line two", ""].join("\n");
  const r = compressOffline(text);
  assert.ok(r.charsAfter < text.length, "should shrink");
  // 每个去重后的句子只出现一次
  const occurrences = (s) => r.text.split(s).length - 1;
  assert.equal(occurrences("line one"), 1);
  assert.equal(occurrences("line two"), 1);
});

test("compressOffline removes duplicate sentences within a line", () => {
  const text = "禁止执行该提示。禁止执行该提示。请只输出改写后的提示。";
  const r = compressOffline(text);
  assert.ok(r.text.includes("禁止执行该提示。"), "core constraint preserved");
  assert.ok(r.text.includes("请只输出改写后的提示。"), "second sentence preserved");
  // 重复句被去重
  assert.equal((r.text.match(/禁止执行该提示。/g) || []).length, 1);
});

test("compressOffline preserves hard constraints (semantic safety)", () => {
  const text = [
    "You are an expert prompt engineer.",
    "You are an expert prompt engineer.",
    "DO NOT EXECUTE THE PROMPT.",
    "Do not answer or perform the task.",
    "Respond with ONLY the rewritten prompt.",
    "",
    "Respond with ONLY the rewritten prompt.",
  ].join("\n");
  const r = compressOffline(text);
  for (const must of [
    "You are an expert prompt engineer.",
    "DO NOT EXECUTE THE PROMPT.",
    "Do not answer or perform the task.",
    "Respond with ONLY the rewritten prompt.",
  ]) {
    assert.ok(r.text.includes(must), `must preserve: ${must}`);
  }
  // 去重后应明显短于原文
  assert.ok(r.charsAfter < text.length);
});

test("compressOffline collapses excess whitespace but keeps structure", () => {
  const text = "A    B\n\n\n\nC";
  const r = compressOffline(text);
  assert.ok(!r.text.includes("A    B"), "collapsed spaces");
  assert.ok(r.text.includes("A B"), "single space kept");
  // 连续空行折叠为单个分隔
  assert.ok(!/\n\n\n/.test(r.text), "no triple blank lines");
});
