import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

test("configures the HTTP dispatcher before exposing the Start fetch handler", () => {
  const configureCall = source.indexOf("configureHttpDispatcher();");
  const entryCreation = source.indexOf("createServerEntry({");
  const handlerCall = source.indexOf("handler.fetch(request)");
  assert.ok(configureCall >= 0);
  assert.ok(entryCreation > configureCall);
  assert.ok(handlerCall > configureCall);
  assert.doesNotMatch(source, /fetch\(request\)[\s\S]*configureHttpDispatcher/);
});
