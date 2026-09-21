import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Importing the module is a parse smoke test.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `end marker not found after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("the shortcut's visibility comes from the pure pi#18 rule", () => {
  assert.match(source, /import \{ shouldShowDefaultCwdShortcut, syntheticProjectFor \} from "@\/lib\/default-cwd-shortcut";/);
  assert.match(
    source,
    /const showDefaultCwdShortcut = useMemo\(\s*\(\) => shouldShowDefaultCwdShortcut\(pinnedProjects, defaultCwd\),\s*\[pinnedProjects, defaultCwd\],\s*\);/,
  );
});

test("the default-directory button is gated by the visibility rule", () => {
  const body = sliceBetween("{/* Default cwd shortcut", "handleDefaultCwd();");
  assert.match(body, /\{!customPathOpen && showDefaultCwdShortcut && \(/);
});

test("the default directory is read without side effects from GET /api/default-cwd", () => {
  const body = sliceBetween(
    "// Read-only: reports today's ~/pi-cwd-<date> without creating it.",
    "}, []);",
  );
  assert.match(body, /fetch\("\/api\/default-cwd"\)/);
  assert.doesNotMatch(body, /method: "POST"/);
  assert.match(body, /if \(d\.cwd\) setDefaultCwd\(d\.cwd\);/);
});

test("clicking the shortcut always writes an explorer selection", () => {
  // Even a session-less default directory gets a synthetic trailing section.
  const body = sliceBetween(
    "const handleDefaultCwd = useCallback(",
    "}, [projectFor]);",
  );
  assert.match(body, /setExplorerSelection\(projectFor\(data\.cwd\) \?\? syntheticProjectFor\(data\.cwd\)\);/);
  // The click itself still goes through POST, which creates and
  // allow-lists the directory.
  assert.match(body, /fetch\("\/api\/default-cwd", \{ method: "POST" \}\)/);
});
