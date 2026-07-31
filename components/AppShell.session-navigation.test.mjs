import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("重复选择当前会话不会重挂载聊天窗口", () => {
  assert.match(source, /activeSessionIdRef\.current === session\.id\) return/);
});

test("会话切换只更新地址栏而不发起 App Router 导航", () => {
  assert.match(source, /window\.history\.replaceState\(window\.history\.state/);
  assert.match(source, /replaceSessionUrl\(session\.id\)/);
});
