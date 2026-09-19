import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("first paint does not read tab sessionStorage", () => {
  assert.match(
    source,
    /const \[initialNavigation, setInitialNavigation\] = useState\(\(\) => getInitialNavigation\(searchParams\)\);/,
  );
  assert.doesNotMatch(
    source,
    /useState\(\(\) => getInitialNavigation\(searchParams,\s*getTabOpen/,
  );
});

test("applies tab session memory after mount instead of suppressing hydration", () => {
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{\s+const next = withTabOpen\(initialNavigation, getTabOpen\(\)\);[\s\S]*?setInitialNavigation\(next\);[\s\S]*?if \(next\.sessionId\) setInitialSessionRestored\(false\);[\s\S]*?\}, \[initialNavigation\]\);/,
  );
  assert.doesNotMatch(source, /suppressHydrationWarning/);
});

test("writes the session URL when tab memory restores onto an empty address bar", () => {
  assert.match(
    source,
    /if \(!isRestore \|\| new URLSearchParams\(window\.location\.search\)\.get\("session"\) !== session\.id\) \{\s+router\.replace\(`\?session=\$\{encodeURIComponent\(session\.id\)\}`/,
  );
});

test("New session is remembered as this tab's selection", () => {
  const start = source.indexOf("  const handleNewSession = useCallback");
  const end = source.indexOf("  // Global keyboard shortcuts", start);
  const body = source.slice(start, end);
  assert.match(body, /router\.replace\(`\?cwd=\$\{encodeURIComponent\(cwd\)\}`/);
});

test("deleting the current session forgets its tab memory", () => {
  const start = source.indexOf("  const handleSessionDeleted = useCallback");
  const end = source.indexOf("  const handleOpenFile = useCallback", start);
  const body = source.slice(start, end);
  assert.match(body, /clearTabOpenSession\(sessionId\);/);
  assert.ok(body.indexOf("clearTabOpenSession(sessionId)") < body.indexOf("setSelectedSession(null)"));
});
