import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  DEFAULT_CWD_TEMPLATE,
  readDefaultCwdPath,
  resolveDefaultCwdPath,
  writeDefaultCwdPath,
} = await createJiti(import.meta.url).import("./default-cwd.ts");

const home = join("/tmp", "pi-web-home");
const now = new Date("2026-09-19T15:04:05Z");

test("empty config resolves to a dated folder in the home directory", () => {
  assert.equal(
    resolveDefaultCwdPath("", { home, now }),
    join(home, "pi-cwd-20260919"),
  );
  assert.equal(DEFAULT_CWD_TEMPLATE, "~/pi-cwd-{date}");
});

test("expands ~, {date}, and absolute custom paths", () => {
  assert.equal(resolveDefaultCwdPath("~/scratch", { home, now }), join(home, "scratch"));
  assert.equal(
    resolveDefaultCwdPath("~/work/pi-{date}", { home, now }),
    join(home, "work", "pi-20260919"),
  );
  assert.equal(
    resolveDefaultCwdPath(join(home, "fixed"), { home, now }),
    join(home, "fixed"),
  );
});

test("rejects relative paths and null bytes", () => {
  assert.throws(() => resolveDefaultCwdPath("relative/dir", { home, now }), /absolute path/);
  assert.throws(() => resolveDefaultCwdPath("{date}", { home, now }), /absolute path/);
  assert.throws(() => resolveDefaultCwdPath("/tmp/bad\0path", { home, now }), /null bytes/);
});

test("persists a custom path and preserves unrelated pi-web.json fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-default-cwd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "agent", "pi-web.json");
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({ futureSetting: true }));

  assert.equal(readDefaultCwdPath(settingsPath), "");
  assert.equal(writeDefaultCwdPath("~/scratch", settingsPath, { home, now }), "~/scratch");
  assert.equal(readDefaultCwdPath(settingsPath), "~/scratch");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    futureSetting: true,
    defaultCwd: "~/scratch",
  });

  assert.equal(writeDefaultCwdPath("  ", settingsPath, { home, now }), "");
  assert.equal(readDefaultCwdPath(settingsPath), "");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    futureSetting: true,
  });
});

test("does not create a settings file when clearing an unset path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-default-cwd-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "missing", "pi-web.json");

  assert.equal(writeDefaultCwdPath("", settingsPath, { home, now }), "");
  await assert.rejects(readFile(settingsPath), { code: "ENOENT" });
});

test("rejects a damaged settings file without overwriting it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-default-cwd-bad-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settingsPath = join(root, "pi-web.json");
  await writeFile(settingsPath, "{");

  assert.throws(() => readDefaultCwdPath(settingsPath));
  assert.throws(() => writeDefaultCwdPath("~/scratch", settingsPath, { home, now }));
  assert.equal(await readFile(settingsPath, "utf8"), "{");
});
