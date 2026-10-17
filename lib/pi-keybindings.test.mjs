import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { keybindingsPath, readKeybindingsFile } = await jiti.import("@/lib/pi-keybindings.ts");

async function withAgentDir(t, contents) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-keybindings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (contents !== undefined) await writeFile(join(dir, "keybindings.json"), contents, "utf8");
  return dir;
}

test("reads the user's keybindings.json, the file the CLI reads", async (t) => {
  const dir = await withAgentDir(t, JSON.stringify({
    "app.message.followUp": ["alt+enter", "ctrl+enter"],
    "app.session.new": "ctrl+alt+n",
  }));
  assert.equal(keybindingsPath(dir), join(dir, "keybindings.json"));
  assert.deepEqual(readKeybindingsFile(dir), {
    "app.message.followUp": ["alt+enter", "ctrl+enter"],
    "app.session.new": "ctrl+alt+n",
  });
});

test("a missing file reads as no bindings, which leaves the defaults", async (t) => {
  const dir = await withAgentDir(t, undefined);
  assert.deepEqual(readKeybindingsFile(dir), {});
});

test("a broken file never fails the page", async (t) => {
  const dir = await withAgentDir(t, "{ this is not json");
  assert.deepEqual(readKeybindingsFile(dir), {});
  // Nor does one that parses to the wrong shape.
  const listDir = await withAgentDir(t, "[\"ctrl+n\"]");
  assert.deepEqual(readKeybindingsFile(listDir), {});
});

test("a byte order mark does not stop the file from parsing", async (t) => {
  const dir = await withAgentDir(t, "\uFEFF{\"app.session.new\":\"ctrl+n\"}");
  assert.deepEqual(readKeybindingsFile(dir), { "app.session.new": "ctrl+n" });
});
