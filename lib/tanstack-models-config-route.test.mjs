import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const handlerSource = await readFile(new URL("../app/api/models-config/route.ts", import.meta.url), "utf8");
const adapterSource = await readFile(new URL("../src/routes/api/models-config.ts", import.meta.url), "utf8");

test("models config handler uses standard Web response APIs", () => {
  assert.doesNotMatch(handlerSource, /next\/server|NextResponse/);
  assert.match(handlerSource, /Response\.json/);
});

test("TanStack models config route delegates GET and PUT to the shared handler", () => {
  assert.match(adapterSource, /GET: \(\) => getModelsConfig\(\)/);
  assert.match(adapterSource, /PUT: \(\{ request \}\) => putModelsConfig\(request\)/);
});

test("models config PUT writes before refreshing live sessions", () => {
  const writeIndex = handlerSource.indexOf("writeModelsConfig(body)");
  const refreshIndex = handlerSource.indexOf("await refreshRpcSessionModelConfigs()");
  assert.ok(writeIndex >= 0);
  assert.ok(refreshIndex > writeIndex);
});
