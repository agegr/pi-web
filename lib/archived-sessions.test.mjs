import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { parseArchivedSessionIds } = await jiti.import("./archived-sessions.ts");

test("parseArchivedSessionIds keeps string ids and ignores junk", () => {
  assert.deepEqual([...parseArchivedSessionIds(null)], []);
  assert.deepEqual([...parseArchivedSessionIds('["one","two"]')], ["one", "two"]);
  assert.deepEqual([...parseArchivedSessionIds('["ok",1,null]')], ["ok"]);
  assert.deepEqual([...parseArchivedSessionIds("{")], []);
  assert.deepEqual([...parseArchivedSessionIds('"nope"')], []);
});
