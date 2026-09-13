import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownSync, mergeMarkdown } from "./markdown-sync.ts";

const base = "Title\n\nFirst paragraph\n\nLast paragraph\n";
function fixture(t, overrides = {}, draft) {
  let disk = base;
  let stored = null;
  const writes = [];
  const sync = new MarkdownSync(base, {
    read: async () => disk,
    write: async (content, expected) => {
      writes.push({ content, expected });
      if (disk !== expected) return { conflict: true, content: disk };
      disk = content; return {};
    },
    persist: (value) => { stored = value; }, ...overrides,
  }, draft);
  t.after(() => sync.dispose());
  return { sync, writes, setDisk: (value) => { disk = value; }, disk: () => disk, stored: () => stored };
}

test("three-way merge retains both disjoint edits and original whitespace", () => {
  const merged = mergeMarkdown(base, base.replace("Title", "Local title"), base.replace("Last", "External last"));
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.content, base.replace("Title", "Local title").replace("Last", "External last"));
  const crlf = base.replaceAll("\n", "\r\n");
  assert.equal(mergeMarkdown(crlf, crlf, crlf).content, crlf);
});

test("save detects an unannounced disk change, merges, then saves against the fresh baseline", async (t) => {
  const f = fixture(t);
  f.sync.edit(base.replace("Title", "Local"));
  f.setDisk(base.replace("Last", "External"));
  await f.sync.save();
  assert.equal(f.sync.state.conflicts.length, 0);
  await f.sync.save();
  assert.match(f.disk(), /^Local/);
  assert.match(f.disk(), /External paragraph/);
  assert.equal(f.stored(), null);
});

test("conflicts keep drafts, allow continued typing, and resolve only the selected passage", async (t) => {
  const f = fixture(t);
  f.sync.edit(base.replace("Title", "Mine"));
  f.setDisk(base.replace("Title", "Theirs").replace("Last", "External"));
  await f.sync.refresh();
  assert.equal(f.sync.state.conflicts.length, 1);
  assert.match(f.sync.state.content, /^Mine/);
  assert.match(f.sync.state.content, /External paragraph/);
  await f.sync.save();
  assert.equal(f.writes.length, 0);
  f.sync.edit(f.sync.state.content.replace("First", "More typing in first"));
  f.sync.resolve(f.sync.state.conflicts[0].key, "external");
  await f.sync.save();
  assert.match(f.disk(), /^Theirs/);
  assert.match(f.disk(), /More typing/);
  assert.match(f.disk(), /External paragraph/);
});

test("keeping a local conflict still retains other external changes", async (t) => {
  const f = fixture(t);
  f.sync.edit(base.replace("Title", "Mine"));
  f.setDisk(base.replace("Title", "Theirs").replace("Last", "External"));
  await f.sync.refresh();
  f.sync.resolve(f.sync.state.conflicts[0].key, "local");
  assert.equal(f.sync.state.conflicts.length, 0);
  await f.sync.save();
  assert.match(f.disk(), /^Mine/);
  assert.match(f.disk(), /External paragraph/);
});

test("save failure retains the draft for retry and reopening", async (t) => {
  const f = fixture(t, { write: async () => { throw new Error("disk full"); } });
  f.sync.edit("unsaved\n");
  await f.sync.save();
  assert.equal(f.sync.state.content, "unsaved\n");
  assert.equal(f.sync.state.error, "disk full");
  assert.deepEqual(f.stored(), { base, content: "unsaved\n" });
  const restored = fixture(t, {}, f.stored());
  await restored.sync.save();
  assert.equal(restored.disk(), "unsaved\n");
});

test("edits made during a save remain dirty and are saved next", async (t) => {
  let finish;
  const f = fixture(t, { write: () => new Promise((resolve) => { finish = resolve; }) });
  f.sync.edit(base + "one\n");
  const saving = f.sync.save();
  f.sync.edit(base + "one two\n");
  finish({}); await saving;
  assert.equal(f.sync.state.content, base + "one two\n");
  assert.equal(f.sync.dirty, true);
  assert.equal(f.stored().base, base + "one\n");
});

test("IME composition defers external reads and saving", async (t) => {
  const f = fixture(t);
  f.sync.setComposing(true);
  f.sync.edit(base.replace("Title", "中文输入"));
  f.setDisk(base.replace("Last", "External"));
  await f.sync.refresh(); await f.sync.save();
  assert.equal(f.writes.length, 0);
  assert.doesNotMatch(f.sync.state.content, /External/);
  f.sync.setComposing(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(f.sync.state.content, /中文输入/);
  assert.match(f.sync.state.content, /External/);
});

test("a completed old save cannot erase a newer editor's persisted draft", async (t) => {
  let finish;
  const f = fixture(t, { write: () => new Promise((resolve) => { finish = resolve; }) });
  f.sync.edit("draft\n");
  const saving = f.sync.save();
  f.sync.dispose();
  finish({}); await saving;
  assert.equal(f.stored().content, "draft\n");
});
