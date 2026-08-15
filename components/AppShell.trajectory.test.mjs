import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("AppShell renders Chat and Trajectory sibling view tabs", () => {
  assert.match(appShell, /sessionView/);
  assert.match(appShell, /"trajectory"/);
  assert.match(appShell, /session-view-tabs/);
  assert.match(appShell, /setSessionView\("chat"\)/);
});

test("view tabs sit outside the scrollable center column", () => {
  assert.ok(appShell.indexOf("session-view-tabs") < appShell.indexOf('className="app-center-column"'));
});

test("ChatWindow owns session state and renders TrajectoryView in the workspace", () => {
  assert.match(chatWindow, /sessionView/);
  assert.match(chatWindow, /TrajectoryView/);
  assert.match(chatWindow, /onTrajectoryVersionChange/);
  assert.match(chatWindow, /activeLeafId/);
});

test("css styles the sibling view tabs", () => {
  assert.match(css, /\.session-view-tabs/);
});
