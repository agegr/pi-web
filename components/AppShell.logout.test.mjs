import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

const logoutButton = source.match(/const renderLogoutButton = \(\) => \{[\s\S]*?\n  \};/)?.[0];
const logoutHandler = source.match(/const handleWebLogout = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/)?.[0];

test("offers a desktop top-bar logout shortcut when browser password auth is on", () => {
  assert.ok(logoutButton);
  assert.match(logoutButton, /if \(!webAuthEnabled\) return null;/);
  assert.match(logoutButton, /data-top-bar-logout="true"/);
  assert.match(logoutButton, /translate\("auth\.logOut"\)/);
  // A failed request is reported through the tooltip and the icon colour, since
  // the top bar has no other surface for an error.
  assert.match(logoutButton, /webAuthLogoutFailed \? translate\("auth\.logoutFailed"\) : label/);

  // The status comes from the same route the settings panel reads.
  assert.match(source, /fetch\("\/api\/web-auth", \{ signal: controller\.signal \}\)/);
  assert.match(source, /setWebAuthEnabled\(data\?\.enabled === true\)/);
});

test("logs out by clearing the web session and returning to the login page", () => {
  assert.ok(logoutHandler);
  assert.match(logoutHandler, /fetch\("\/api\/web-auth", \{ method: "DELETE" \}\)/);
  assert.match(logoutHandler, /window\.location\.replace\("\/login"\)/);
  assert.match(logoutHandler, /setWebAuthLogoutFailed\(true\)/);
  assert.match(logoutHandler, /setWebAuthLoggingOut\(false\)/);
});

test("places the shortcut immediately before the session statistics button", () => {
  assert.match(
    source,
    /\{!isMobile && \(\s*<>[\s\S]*?\{renderChatToolbarActions\(false\)\}\s*\{renderLogoutButton\(\)\}\s*\{renderSessionStatsButton\(false\)\}/,
  );
  // Desktop only: the mobile toolbar keeps its own control set.
  assert.equal((source.match(/\{renderLogoutButton\(\)\}/g) ?? []).length, 1);
  assert.doesNotMatch(source, /data-mobile-toolbar-logout/);
});

test("keeps exactly one right-aligned auto margin in the top bar", () => {
  // Only one flex item may carry `margin-left: auto`. Two auto margins split the
  // free space and pull the group toward the middle of the bar, which is why the
  // logout button takes it over from the statistics button while it is visible.
  assert.ok(logoutButton);
  assert.match(logoutButton, /marginLeft: "auto",/);
  assert.match(source, /marginLeft: mobile \|\| webAuthEnabled \? 0 : "auto",/);
  assert.match(
    source,
    /marginLeft: !mobile && !webAuthEnabled && !sessionStats && !contextUsage \? "auto" : 0,/,
  );
});

test("keeps the shortcut additive to the existing settings logout action", () => {
  assert.match(settingsSource, /fetch\("\/api\/web-auth", \{ method: "DELETE" \}\)/);
  assert.match(settingsSource, /t\("auth\.logOut"\)/);
});

test("reuses the existing logout translations in every bundled locale", async () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    assert.match(messages, /"auth\.logOut":/);
    assert.match(messages, /"auth\.logoutFailed":/);
  }
});
