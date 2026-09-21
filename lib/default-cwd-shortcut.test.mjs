import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  isSameExplorerPath,
  shouldShowDefaultCwdShortcut,
  syntheticProjectFor,
} = await jiti.import("./default-cwd-shortcut.ts");

const HOME = "/home/user";
const DEFAULT = `${HOME}/pi-cwd-20260921`;

test("no pinned projects keeps the shortcut visible", () => {
  assert.equal(shouldShowDefaultCwdShortcut([], DEFAULT), true);
});

test("pinned projects hide the shortcut when the default directory is outside the set", () => {
  const pinned = [
    { key: "/repo/a", root: "/repo/a" },
    { key: "/repo/b", root: "/repo/b" },
  ];
  assert.equal(shouldShowDefaultCwdShortcut(pinned, DEFAULT), false);
});

test("a pinned project that IS the default directory keeps the shortcut visible", () => {
  const pinned = [
    { key: "/repo/a", root: "/repo/a" },
    { key: `${HOME}/pi-cwd-20260921`, root: DEFAULT },
  ];
  assert.equal(shouldShowDefaultCwdShortcut(pinned, DEFAULT), true);
});

test("the pinned-root comparison is case- and separator-insensitive", () => {
  // Pinned display roots can carry different casing or slash style than the
  // server-reported default directory (Windows backslashes, trailing slash).
  assert.equal(
    shouldShowDefaultCwdShortcut([{ key: "k", root: `${DEFAULT}/` }], DEFAULT),
    true,
  );
  assert.equal(
    shouldShowDefaultCwdShortcut([{ key: "k", root: DEFAULT.toUpperCase() }], DEFAULT),
    true,
  );
  assert.equal(
    shouldShowDefaultCwdShortcut([{ key: "k", root: `C:\\Users\\dev\\pi-cwd-20260921` }], "C:/Users/dev/pi-cwd-20260921"),
    true,
  );
  // A different directory that merely shares a prefix stays hidden.
  assert.equal(
    shouldShowDefaultCwdShortcut([{ key: "k", root: `${HOME}/pi-cwd-20260920` }], DEFAULT),
    false,
  );
});

test("an unknown default directory keeps the historical visible state", () => {
  // GET /api/default-cwd still in flight (or failed) — no evidence the
  // shortcut diverges from the pins, so no flash of a hidden button.
  assert.equal(shouldShowDefaultCwdShortcut([{ key: "/repo/a", root: "/repo/a" }], null), true);
  assert.equal(shouldShowDefaultCwdShortcut([{ key: "/repo/a", root: "/repo/a" }], ""), true);
});

test("loose path equality normalizes case, separators and trailing slashes", () => {
  assert.equal(isSameExplorerPath("/a/b", "/A/B/"), true);
  assert.equal(isSameExplorerPath("C:\\x\\y", "c:/X/Y"), true);
  assert.equal(isSameExplorerPath("/a/b", "/a/b/c"), false);
});

test("the synthetic fallback degrades root and key to the directory string", () => {
  assert.deepEqual(syntheticProjectFor(DEFAULT), { root: DEFAULT, key: DEFAULT });
});
