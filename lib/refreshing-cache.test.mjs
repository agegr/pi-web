import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createRefreshingCache } = await createJiti(import.meta.url).import("./refreshing-cache.ts");

let keys = 0;
const freshKey = () => `pi-web:test-refreshing-cache:${keys++}`;

test("callers share one fetch, and the value is kept until it expires", async () => {
  let calls = 0;
  const read = createRefreshingCache(freshKey(), 60_000, async () => ++calls);
  assert.deepEqual(await Promise.all([read(), read()]), [1, 1]);
  assert.equal(await read(), 1);
  assert.equal(calls, 1);
});

test("an expired value is fetched again", async () => {
  let calls = 0;
  const read = createRefreshingCache(freshKey(), 0, async () => ++calls);
  assert.equal(await read(), 1);
  assert.equal(await read(), 2);
});

test("a failed fetch answers with the last value, or throws without one", async () => {
  let fail = true;
  const read = createRefreshingCache(freshKey(), 0, async () => {
    if (fail) throw new Error("offline");
    return "v1";
  });
  await assert.rejects(read(), { message: "offline" });
  fail = false;
  assert.equal(await read(), "v1");
  fail = true;
  assert.equal(await read(), "v1");
});
