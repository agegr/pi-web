import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  deriveDirectoryFilter,
  filterDirectoryEntries,
} = await jiti.import("./directory-picker-filter.ts");

test("deriveDirectoryFilter: 输入框等于当前目录返回空串", () => {
  assert.equal(deriveDirectoryFilter("/a/b", "/a/b"), "");
});

test("deriveDirectoryFilter: 当前目录+斜杠+后缀 取后缀为筛选词", () => {
  assert.equal(deriveDirectoryFilter("/a/b", "/a/b/foo"), "foo");
  assert.equal(deriveDirectoryFilter("/a/b", "/a/b/Foo"), "Foo");
});

test("deriveDirectoryFilter: 仅尾斜杠返回空串(不筛选)", () => {
  assert.equal(deriveDirectoryFilter("/a/b", "/a/b/"), "");
});

test("deriveDirectoryFilter: 多级后缀整体作为筛选词", () => {
  assert.equal(deriveDirectoryFilter("/a/b", "/a/b/foo/bar"), "foo/bar");
});

test("deriveDirectoryFilter: 与当前目录无前缀关系返回 null(跳转语义)", () => {
  assert.equal(deriveDirectoryFilter("/a/b", "/c/d"), null);
  assert.equal(deriveDirectoryFilter("/a/b", "/a/bx"), null);
});

test("deriveDirectoryFilter: Windows 路径归一化斜杠后比较", () => {
  assert.equal(deriveDirectoryFilter("C:\\a\\b", "C:\\a\\b\\foo"), "foo");
  assert.equal(deriveDirectoryFilter("C:\\a\\b", "C:/a/b/foo"), "foo");
  assert.equal(deriveDirectoryFilter("C:/a/b", "C:\\a\\b\\foo"), "foo");
});

test("filterDirectoryEntries: null 或空串返回全部副本", () => {
  const entries = [{ name: "foo", path: "/a/b/foo" }, { name: "bar", path: "/a/b/bar" }];
  assert.deepEqual(filterDirectoryEntries(entries, null), entries);
  assert.deepEqual(filterDirectoryEntries(entries, ""), entries);
});

test("filterDirectoryEntries: 不区分大小写的子串包含", () => {
  const entries = [
    { name: "foo", path: "/a/b/foo" },
    { name: "bar", path: "/a/b/bar" },
    { name: "FoOBar", path: "/a/b/FoOBar" },
  ];
  assert.deepEqual(filterDirectoryEntries(entries, "foo"), [
    { name: "foo", path: "/a/b/foo" },
    { name: "FoOBar", path: "/a/b/FoOBar" },
  ]);
});

test("filterDirectoryEntries: 无匹配返回空数组", () => {
  const entries = [{ name: "foo", path: "/a/b/foo" }];
  assert.deepEqual(filterDirectoryEntries(entries, "zzz"), []);
});
