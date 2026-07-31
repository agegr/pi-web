import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookSource = await readFile(new URL("./useCompletionNotification.ts", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("requests permission only from the explicit notification toggle", () => {
  assert.match(hookSource, /const toggle = useCallback\(async \(\) =>/);
  assert.match(hookSource, /await Notification\.requestPermission\(\)/);
  assert.ok(
    hookSource.indexOf("Notification.requestPermission()") > hookSource.indexOf("const toggle = useCallback"),
  );
});

test("shows the first-visit prompt only while permission is undecided", () => {
  assert.match(hookSource, /getPermission\(\) === "default"/);
  assert.match(hookSource, /PROMPT_DISMISSED_KEY/);
});

test("service worker notification click returns to the target session", () => {
  assert.match(serviceWorkerSource, /notificationclick/);
  assert.match(serviceWorkerSource, /client\.navigate\(targetUrl\)/);
  assert.match(serviceWorkerSource, /self\.clients\.openWindow\(targetUrl\)/);
});

test("completion notifications are also sent while the app is focused", () => {
  assert.doesNotMatch(hookSource, /document\.visibilityState/);
  assert.doesNotMatch(hookSource, /document\.hasFocus/);
  assert.match(hookSource, /registration\.showNotification\(title, options\)/);
  assert.match(hookSource, /new Notification\(title, options\)/);
});

test("exposes a session notification sender for completion and input requests", () => {
  assert.match(hookSource, /const notifySession = useCallback/);
  assert.match(hookSource, /notifySession,/);
});
