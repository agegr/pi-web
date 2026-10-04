import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { serializeByKey } = await jiti.import("./key-serializer.ts");

test("tasks for one key run one after another, a failed one included; other keys run alongside", async () => {
  const storeKey = Symbol("key-serializer-test");
  const log = [];
  const task = (name, ms, fail = false) => async () => {
    log.push(`start ${name}`);
    await delay(ms);
    log.push(`end ${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  const first = serializeByKey(storeKey, "a", task("a1", 30, true));
  const second = serializeByKey(storeKey, "a", task("a2", 5));
  const other = serializeByKey(storeKey, "b", task("b1", 5));
  await assert.rejects(first, /a1/);
  assert.equal(await second, "a2");
  assert.equal(await other, "b1");
  assert.ok(log.indexOf("start a2") > log.indexOf("end a1"), log.join(", "));
  assert.ok(log.indexOf("end b1") < log.indexOf("end a1"), log.join(", "));
  // The chain is kept under the caller's own symbol, and goes once it ran out.
  await delay(0);
  assert.equal(globalThis[storeKey].size, 0);
});

test("a second copy of the module shares the chains under the same symbol", async () => {
  const storeKey = Symbol.for("pi-web:key-serializer-test");
  const copy = (await createJiti(import.meta.url, { moduleCache: false }).import("./key-serializer.ts")).serializeByKey;
  const log = [];
  const running = serializeByKey(storeKey, "k", async () => {
    await delay(20);
    log.push("first");
  });
  await copy(storeKey, "k", async () => log.push("second"));
  await running;
  assert.deepEqual(log, ["first", "second"]);
});
