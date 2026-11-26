import assert from "node:assert/strict";
import test from "node:test";
import { isPiOffline } from "./pi-offline.ts";

test("PI_OFFLINE keeps the SDK runtime's meaning: any value, empty included, is offline", () => {
  const previous = process.env.PI_OFFLINE;
  try {
    delete process.env.PI_OFFLINE;
    assert.equal(isPiOffline(), false);
    for (const value of ["", "0", "false", "1", "yes"]) {
      process.env.PI_OFFLINE = value;
      assert.equal(isPiOffline(), true, JSON.stringify(value));
    }
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
});
