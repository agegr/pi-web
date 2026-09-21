import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const source = await readFile(new URL("./useBackgroundTasks.ts", import.meta.url), "utf8");

test("terminal-notification dedupe fires exactly once per task id", () => {
  const context = vm.createContext({ Set, console });
  vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf("const notifiedTerminalTaskIds"), source.indexOf("export type BackgroundTasksFetchState")).replace(/export /g, "")), context);
  const first = context.markTerminalNotified("task-a");
  const second = context.markTerminalNotified("task-a");
  const other = context.markTerminalNotified("task-b");
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(other, true);
});

test("the hook degrades without a session and refreshes through the API", () => {
  assert.match(source, /if \(!sessionId\) \{/);
  assert.match(source, /setState\(\{ kind: "unavailable", error: "no active session" \}\)/);
  assert.match(source, /\/api\/agent\/\$\{encodeURIComponent\(sessionId\)\}\/bg-tasks/);
  assert.match(source, /\/logs\?\$\{params\}/);
  assert.match(source, /method: "POST"/);
});

test("no HTTP while the panel is closed — the browser logs every non-2xx fetch as a console error", () => {
  assert.match(source, /if \(!sessionId \|\| !fetchEnabled\) return;/);
  assert.match(source, /useBackgroundTasks\(sessionId: string \| null, fetchEnabled: boolean\)/);
});

test("live events apply updates directly and refresh on terminal transitions", () => {
  assert.match(source, /background_tasks_update"\) \{\s*setState\(\{ kind: "ready", tasks: event\.tasks \}\)/);
  assert.match(source, /background_task_terminal"\) \{[\s\S]*?refresh\(\);/);
});

test("running count derives from the ready task list only", () => {
  assert.match(source, /state\.kind === "ready" \? state\.tasks\.filter\(\(task\) => task\.status === "running"\)\.length : 0/);
});

test("stale fetches are dropped by sequence number", () => {
  assert.match(source, /if \(seq !== fetchSeq\.current\) return;/);
  assert.match(source, /const seqAtMount = fetchSeq\.current;/);
  assert.match(source, /return \(\) => \{ fetchSeq\.current = seqAtMount \+ 1; \};/);
});
