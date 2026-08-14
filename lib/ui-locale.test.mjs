import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./ui-locale.ts");
}

test("accepts only en and zh-CN", async () => {
  const { parseUiLocale } = await loadSubject();
  assert.equal(parseUiLocale("en"), "en");
  assert.equal(parseUiLocale("zh-CN"), "zh-CN");
  assert.equal(parseUiLocale("ja"), null);
  assert.equal(parseUiLocale("zh"), null);
  assert.equal(parseUiLocale(""), null);
});

test("persists the UI locale for extensions to read", async () => {
  const { writeUiLocale, readUiLocale } = await loadSubject();
  const dir = mkdtempSync(join(tmpdir(), "pi-web-ui-locale-"));
  try {
    assert.equal(writeUiLocale("zh-CN", dir), "zh-CN");
    assert.equal(readFileSync(join(dir, "ui-locale"), "utf8"), "zh-CN\n");
    assert.equal(readUiLocale(dir), "zh-CN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
