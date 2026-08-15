import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const zh = readFileSync(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("AppShell renders Chat and Trajectory sibling view tabs", () => {
  assert.match(appShell, /sessionView/);
  assert.match(appShell, /"trajectory"/);
  assert.match(appShell, /SessionViewSwitch/);
  assert.match(appShell, /showSessionView/);
});

test("view switch lives in the header, not the scrollable center column", () => {
  assert.ok(appShell.indexOf("SessionViewSwitch") < appShell.indexOf('className="app-center-column"'));
  assert.doesNotMatch(appShell, /session-view-tabs/);
});

test("ChatWindow owns session state and renders TrajectoryView in the workspace", () => {
  assert.match(chatWindow, /sessionView/);
  assert.match(chatWindow, /TrajectoryView/);
  assert.match(chatWindow, /onTrajectoryVersionChange/);
  assert.match(chatWindow, /activeLeafId/);
});

test("Chinese copy uses 对话 and 轨迹", () => {
  assert.match(zh, /session.viewChat.: "对话"/);
  assert.match(zh, /session.viewTrajectory.: "轨迹"/);
});

test("css styles the compact session view switch", () => {
  assert.match(css, /\.session-view-switch/);
});
