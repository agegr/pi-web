import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");

test("shows direct extensions without adding management actions", () => {
  assert.match(source, /extension\.origin === "top-level"/);
  assert.match(source, /directExtensions\.map/);
  assert.match(source, /shortenPath\(extension\.path\)/);
  assert.doesNotMatch(source, /unlink-extension|unlinkExtension|extension\.linkPath/);
});
