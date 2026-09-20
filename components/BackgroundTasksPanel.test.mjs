import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./BackgroundTasksPanel.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhCNSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const zhTWSource = await readFile(new URL("../lib/i18n/messages/zh-TW.ts", import.meta.url), "utf8");

test("panel rows show name, status dot, time, bytes, exit code, and the agent marker", () => {
  assert.match(source, /task\.name \|\| task\.id/);
  assert.match(source, /STATUS_COLORS/);
  assert.match(source, /formatStartTime\(task\.startTime, locale\)/);
  assert.match(source, /formatBytes\(task\.bytesWritten\)/);
  assert.match(source, /typeof task\.exitCode === "number"/);
  assert.match(source, /task\.isAgent/);
});

test("kill is a two-step confirmation and errors are surfaced inline", () => {
  assert.match(source, /killPendingId === task\.id \? \(/);
  assert.match(source, /setKillPendingId\(task\.id\)/);
  assert.match(source, /killError/);
  // Only running tasks offer the kill affordance.
  assert.match(source, /task\.status === "running" && \(/);
});

test("the tail view renders ANSI safely and marks truncation", () => {
  assert.match(source, /<AnsiText text=\{logs\[selectedTaskId\]\.text\} \/>/);
  assert.match(source, /logs\[selectedTaskId\]\?\.truncated/);
  assert.match(source, /fontFamily: "var\(--font-mono, monospace\)"/);
});

test("empty, loading, and unavailable states are all explicit", () => {
  assert.match(source, /state\.kind === "loading" && \(/);
  assert.match(source, /state\.kind === "unavailable" && \(/);
  assert.match(source, /state\.kind === "ready" && tasks\.length === 0 && \(/);
});

test("every user-facing string goes through i18n", () => {
  const usedKeys = [...source.matchAll(/t\("([a-zA-Z.]+)"\)/g)].map((m) => m[1]);
  assert.ok(usedKeys.length >= 12, `expected many i18n keys, got ${usedKeys.length}`);
  for (const key of usedKeys) {
    assert.ok(!key.includes(" "), `i18n key must not contain spaces: ${key}`);
    assert.ok(key.startsWith("bgTasks.") || key.startsWith("common."), `unnamespaced key: ${key}`);
  }
});

test("all three locales carry the bgTasks keys", () => {
  for (const [name, localeSource] of [["en", enSource], ["zh-CN", zhCNSource], ["zh-TW", zhTWSource]]) {
    for (const key of [
      "bgTasks.title", "bgTasks.open", "bgTasks.close", "bgTasks.refresh", "bgTasks.loading",
      "bgTasks.unavailable", "bgTasks.empty", "bgTasks.kill", "bgTasks.killConfirm", "bgTasks.agentTask",
      "bgTasks.exitCode", "bgTasks.output", "bgTasks.outputTruncated", "bgTasks.selectTask",
      "bgTasks.notification.title", "bgTasks.notification.body",
      "bgTasks.status.running", "bgTasks.status.completed", "bgTasks.status.failed", "bgTasks.status.killed",
    ]) {
      assert.ok(localeSource.includes(`"${key}"`), `${name} is missing ${key}`);
    }
  }
});

test("AppShell wires the panel, the toolbar badge, and the event callback", () => {
  assert.match(appShellSource, /useBackgroundTasks\(selectedSession\?\.id \?\? null\)/);
  assert.match(appShellSource, /onBackgroundTasksEvent=\{handleBackgroundTasksEvent\}/);
  assert.match(appShellSource, /<BackgroundTasksPanel/);
  assert.match(appShellSource, /bgRunningCount > 0/);
  // Terminal events notify exactly once and jump to the task.
  assert.match(appShellSource, /markTerminalNotified\(task\.id\)/);
  assert.match(appShellSource, /tag: `pi-bg-task:\$\{task\.id\}`/);
  assert.match(appShellSource, /setBgSelectedTaskId\(task\.id\)/);
  // Desktop dock vs mobile drawer.
  assert.match(appShellSource, /isMobile \? \(\s*<>/);
  assert.match(appShellSource, /position: "absolute", top: 0, right: 0, bottom: 0, width: 340/);
});
