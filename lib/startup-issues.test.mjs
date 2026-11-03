import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { collectStartupIssues, STARTUP_ISSUE_LIMIT } = await jiti.import("./startup-issues.ts");

test("a session's startup problems become notices, as pi's TUI prints them at start", () => {
  assert.deepEqual(collectStartupIssues({
    diagnostics: [
      { type: "error", message: "Extension \"/x/p.js\" error: bad provider" },
      { type: "info", message: "not a problem" },
    ],
    extensions: {
      errors: [
        { path: "/ext/broken.js", error: "Unexpected token )" },
        { path: "/ext/c.js", error: "Failed to load extension: ParseError: Unexpected token /ext/c.js:2:0" },
      ],
      warnings: [{ path: "/ext/old.js", warning: "uses a deprecated API" }],
    },
    commandDiagnostics: [{ type: "collision", message: "/deploy is registered twice", path: "/ext/b.js" }],
    modelFallbackMessage: "Could not restore model mock/gone",
  }), [
    { type: "error", message: "Extension \"/x/p.js\" error: bad provider" },
    { type: "error", message: "Extension failed to load: /ext/broken.js: Unexpected token )" },
    { type: "error", message: "Failed to load extension: ParseError: Unexpected token /ext/c.js:2:0" },
    { type: "warning", message: "Extension: /ext/old.js: uses a deprecated API" },
    { type: "warning", message: "/ext/b.js: /deploy is registered twice" },
    { type: "warning", message: "Could not restore model mock/gone" },
  ]);
  assert.deepEqual(collectStartupIssues({}), []);
});

test("a package failing dozens of files gives a bounded number of notices", () => {
  const errors = Array.from({ length: 30 }, (_, i) => ({ path: `/ext/${i}.js`, error: "boom" }));
  const issues = collectStartupIssues({ extensions: { errors } });
  assert.equal(issues.length, STARTUP_ISSUE_LIMIT);
  assert.match(issues.at(-1).message, /^23 more startup issues/);
});
