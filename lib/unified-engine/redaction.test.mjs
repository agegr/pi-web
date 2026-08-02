// redaction.test.mjs —— 递归脱敏器单测（Q5 / 等价迁移 reflect 递归脱敏）
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitize, sanitizeJson } from "./redaction";

test("sanitize：敏感键整体脱敏", () => {
  const out = sanitize({ apiKey: "sk-1234567890abcdef", name: "ok" });
  assert.equal(out.apiKey, "<redacted>");
  assert.equal(out.name, "ok");
});

test("sanitize：高熵字符串部分掩码", () => {
  const out = sanitize("AKIAIOSFODNN7EXAMPLEKEY");
  assert.match(out, /AKIA/); // 保留前缀 4 位
  assert.ok(!out.includes("EXAMPLEKEY")); // 其余打码
});

test("sanitize：数组与嵌套对象递归", () => {
  const out = sanitize([{ token: "abc" }, { nested: { password: "secret" } }]);
  assert.equal(out[0].token, "<redacted>");
  assert.equal(out[1].nested.password, "<redacted>");
});

test("sanitize：循环引用不爆栈（深度上限保护）", () => {
  const obj = {};
  obj.self = obj;
  const out = sanitize(obj, 4);
  assert.ok(out !== null);
});

test("sanitizeJson：脱敏后可序列化", () => {
  const s = sanitizeJson({ authorization: "Bearer xyz" });
  assert.ok(s.includes("<redacted>"));
});
