import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  collectStartupIssues,
  createShownNotices,
  extensionErrorMessage,
  limitStartupNotices,
  STARTUP_ISSUE_LIMIT,
} = await jiti.import("./startup-issues.ts");

test("a session's startup problems become notices, as pi's TUI prints them at start", () => {
  assert.deepEqual(collectStartupIssues({
    diagnostics: [
      { type: "error", message: "Extension \"/x/p.js\" error: bad provider" },
      { type: "info", message: "not a problem" },
    ],
    extensions: {
      errors: [
        { path: "/ext/c.js", error: "Failed to load extension: ParseError: Unexpected token /ext/c.js:2:0" },
        { path: "/ext/d.js", error: "Failed to load extension: boom" },
        // Both extensions still load: pi's loader words the conflict, with no "failed to load".
        { path: "/pkgs/beta/index.js", error: "Tool \"dupe\" conflicts with /pkgs/alpha/index.js" },
      ],
      warnings: [{ path: "/ext/old.js", warning: "uses a deprecated API" }],
    },
  }), [
    { type: "error", message: "Extension \"/x/p.js\" error: bad provider" },
    { type: "error", message: "Failed to load extension: ParseError: Unexpected token /ext/c.js:2:0" },
    { type: "error", message: "/ext/d.js: Failed to load extension: boom" },
    { type: "error", message: "/pkgs/beta/index.js: Tool \"dupe\" conflicts with /pkgs/alpha/index.js" },
    { type: "warning", message: "Extension: /ext/old.js: uses a deprecated API" },
  ]);
  assert.deepEqual(collectStartupIssues({}), []);
});

test("the server log gets every issue, the page a bounded number of notices", () => {
  const errors = Array.from({ length: 30 }, (_, i) => ({ path: `/ext/${i}.js`, error: "boom" }));
  const issues = collectStartupIssues({ extensions: { errors } });
  assert.equal(issues.length, 30);
  const notices = limitStartupNotices(issues);
  assert.equal(notices.length, STARTUP_ISSUE_LIMIT);
  assert.deepEqual(notices.slice(0, -1), issues.slice(0, STARTUP_ISSUE_LIMIT - 1));
  assert.deepEqual(notices.at(-1), { type: "warning", message: "23 more startup issues: see the server log" });
  assert.deepEqual(limitStartupNotices(issues.slice(0, STARTUP_ISSUE_LIMIT)), issues.slice(0, STARTUP_ISSUE_LIMIT));
});

test("an extension error names its extension as pi's TUI does", () => {
  assert.equal(extensionErrorMessage("/ext/a.js", "start boom"), "Extension \"/ext/a.js\" error: start boom");
  assert.equal(extensionErrorMessage(undefined, "start boom"), "start boom");
  assert.equal(extensionErrorMessage("", "start boom"), "start boom");
  assert.equal(extensionErrorMessage("custom-ui:6f1c", "render failed"), "render failed");
  assert.equal(extensionErrorMessage("extension-widget:todo", "factory threw"), "factory threw");
});

test("a page shows each notice id once, remembering the latest ones", () => {
  const isFirstShowing = createShownNotices(2);
  assert.equal(isFirstShowing("a"), true);
  assert.equal(isFirstShowing("a"), false);
  assert.equal(isFirstShowing("b"), true);
  assert.equal(isFirstShowing("c"), true);
  assert.equal(isFirstShowing("b"), false);
  // The oldest id was let go.
  assert.equal(isFirstShowing("a"), true);
});
