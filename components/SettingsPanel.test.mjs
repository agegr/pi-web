import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");

test("the trust dialog Settings › MCP opens stacks above Settings", () => {
  const zIndex = (selector) => Number(cssSource.match(new RegExp(`\\${selector} \\{[^}]*z-index: (\\d+);`))?.[1]);
  assert.ok(zIndex(".project-trust-backdrop") > zIndex(".settings-dialog-backdrop"));
});

test("signing out removes the stored drafts once the server signed out", async () => {
  const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
  assert.match(
    panelSource,
    /if \(!response\.ok\) throw new Error\([^\n]*\);\n(?:\s*\/\/[^\n]*\n)*\s*clearStoredDrafts\(\);\n\s*window\.location\.replace\("\/login"\);/,
  );
});

test("the login page returns only to a destination safeLoginDestination() accepts", () => {
  assert.match(loginSource, /safeLoginDestination\(destination, window\.location\.origin\)/);
});
