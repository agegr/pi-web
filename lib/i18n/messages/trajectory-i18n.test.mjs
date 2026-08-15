import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enLocale } = await jiti.import("./en.ts");
const { zhCNLocale } = await jiti.import("./zh-CN.ts");

test("en and zh-CN trajectory.* keys stay synchronized", () => {
  const enKeys = Object.keys(enLocale.messages).filter((key) => key.startsWith("trajectory.")).sort();
  const zhKeys = Object.keys(zhCNLocale.messages).filter((key) => key.startsWith("trajectory.")).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.ok(enKeys.length > 20, "expected a full trajectory message set");
  for (const key of enKeys) {
    assert.equal(typeof enLocale.messages[key], "string", key);
    assert.equal(typeof zhCNLocale.messages[key], "string", key);
    assert.notEqual(enLocale.messages[key].trim(), "", key);
    assert.notEqual(zhCNLocale.messages[key].trim(), "", key);
  }
});
