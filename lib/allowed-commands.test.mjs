// allowed-commands.test.mjs —— 受控命令白名单单测（M4 / Q1 / Q2）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSafeArg,
  assertSafeArgs,
  isCommandAllowed,
  resolveExecutable,
  resetAllowedCache,
} from "./allowed-commands.ts";

test("isSafeArg：普通路径与空格安全，shell 元字符/控制字符被拒", () => {
  assert.equal(isSafeArg("src/index.ts"), true);
  assert.equal(isSafeArg("--foo=bar"), true);
  assert.equal(isSafeArg("rm -rf /"), false);
  assert.equal(isSafeArg("a;b"), false);
  assert.equal(isSafeArg("$(curl evil)"), false);
  assert.equal(isSafeArg("a\x00b"), false); // 空字节
});

test("assertSafeArgs：整组参数含注入则抛错", () => {
  assert.throws(() => assertSafeArgs(["node", "x && rm"]), /非法命令参数/);
  assert.doesNotThrow(() => assertSafeArgs(["node", "--version"]));
});

test("isCommandAllowed：白名单 basename 命中", () => {
  assert.equal(isCommandAllowed("node"), true);
  assert.equal(isCommandAllowed("NPM"), true); // 小写比对
  assert.equal(isCommandAllowed("/usr/bin/node"), true); // basename 命中
  assert.equal(isCommandAllowed("evil-binary"), false);
});

test("resolveExecutable：纯 basename 经 PATH 解析；越权绝对路径被拒", () => {
  const nodePath = resolveExecutable("node");
  assert.ok(nodePath.includes("node"), "应解析为含 node 的路径");
  assert.throws(() => resolveExecutable("/etc/passwd"), /白名单|不存在/);
  assert.throws(() => resolveExecutable(""), /非法可执行名/);
});

test("resetAllowedCache：缓存可清空（防测试串扰）", () => {
  resetAllowedCache();
  assert.equal(isCommandAllowed("node"), true);
});
