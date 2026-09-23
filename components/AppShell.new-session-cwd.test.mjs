import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// pi#21 review-FAIL blocker fix: the new-session tab's cwd must default to
// the FIRST listed directory (user-confirmed 「默认新建到第一个项目」; the list migrates from the legacy pins, pi#45), else the
// default directory, and only then the current workspace — never the focused
// session's cwd directly.
const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("the new-session tab defaults its cwd to the first pinned project, then the default directory, then the current workspace", () => {
  assert.match(source, /import \{ listCustomDirectories \} from "@\/lib\/custom-directories";/);
  assert.match(source, /const customDirs = listCustomDirectories\(\);\s*if \(customDirs\.length > 0\) return customDirs\[0\]\.path;/);
  assert.match(source, /fetch\("\/api\/default-cwd", \{ method: "POST" \}\)[\s\S]*?if \(data\.cwd\) return data\.cwd;/);
  assert.match(source, /newSessionCwd \?\? selectedSession\?\.cwd \?\? activeCwd \?\? null;\s*\}, \[newSessionCwd, selectedSession, activeCwd\]\);/);
  // The close-last auto page AND the fresh-entry new-session landing (pi#27)
  // both route through the resolver (pi#25 removed the tab-strip "+" and its
  // handleOpenNewSessionTab wrapper, so the sidebar is the sole interactive
  // new-session entry).
  const resolverCallSites = source.match(/resolveNewSessionTabCwd\(\)\.then/g) ?? [];
  assert.equal(resolverCallSites.length, 2, "the resolver must back the close-last auto page and the fresh-entry landing");
  assert.doesNotMatch(source, /const cwd = newSessionCwd \?\? selectedSession\?\.cwd \?\? activeCwd;/);
});

test("the removed tab-strip new-session callback is gone (pi#25 embedded headers)", () => {
  assert.ok(!source.includes("onOpenNewSessionTab"), "the strip's + callback must be gone");
  assert.ok(!source.includes("handleOpenNewSessionTab"), "the dead wrapper must be gone");
});
