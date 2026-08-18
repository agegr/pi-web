import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");

test("shows direct extensions and only offers to unlink managed symlinks", () => {
  assert.match(source, /extension\.origin === "top-level"/);
  assert.match(source, /action: "unlink-extension"/);
  assert.match(source, /extension\.linkPath &&/);
  assert.match(source, /unlinkExtensionKeepsSource/);
});
