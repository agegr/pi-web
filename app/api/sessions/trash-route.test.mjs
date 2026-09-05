import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const trashRoute = await readFile(new URL("./trash/route.ts", import.meta.url), "utf8");
const restoreRoute = await readFile(new URL("./trash/[id]/restore/route.ts", import.meta.url), "utf8");

test("opening or refreshing the session list purges expired trash", () => {
  assert.match(listRoute, /const purgedIds = purgeExpiredTrashedSessions\(\);[\s\S]*?invalidateSessionListCache\(\);[\s\S]*?const force/);
});

test("trash APIs filter by project, batch permanent deletion, and restore paths", () => {
  assert.match(trashRoute, /projectKey is required/);
  assert.match(trashRoute, /listTrashedSessions\(projectKey\)/);
  assert.match(trashRoute, /permanentlyDeleteTrashedSessions\(body\.ids\)/);
  assert.match(restoreRoute, /restoreTrashedSession\(id\)/);
  assert.match(restoreRoute, /invalidateSessionPathCache\(restoredId\)/);
  assert.match(restoreRoute, /SessionTrashConflictError[\s\S]*?409/);
});
