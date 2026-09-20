import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const logsSource = await readFile(new URL("./[taskId]/logs/route.ts", import.meta.url), "utf8");
const killSource = await readFile(new URL("./[taskId]/kill/route.ts", import.meta.url), "utf8");

test("bg-tasks list route degrades explicitly when the bridge is not attached", () => {
  assert.match(listSource, /getRpcSession\(id\)/);
  assert.match(listSource, /getBackgroundTasks\(\) \?\? null/);
  assert.match(listSource, /pi-background-tasks bridge is not attached/);
  assert.match(listSource, /status: 503/);
  assert.match(listSource, /probeCapabilities\(\)/);
  assert.match(listSource, /pi-background-tasks is unavailable/);
  assert.match(listSource, /NextResponse\.json\(\{ tasks: result\.result \}\)/);
  // No 500 path: every failure is a decodable JSON body with a status.
  assert.doesNotMatch(listSource, /throw new Error/);
});

test("bg-tasks logs route clamps input and maps package errors onto HTTP statuses", () => {
  assert.match(logsSource, /bgOperationFailureStatus\(result\.error\)/);
  assert.match(logsSource, /searchParams\.get\("maxBytes"\)/);
  assert.match(logsSource, /Number\.isFinite\(maxBytes\) \? maxBytes : undefined/);
  assert.match(logsSource, /searchParams\.get\("tail"\) !== "false"/);
  assert.match(logsSource, /bridge\.logs\(taskId/);
  // The bridge itself clamps; the route must not reimplement the cap.
  assert.doesNotMatch(logsSource, /50 \* 1024/);
});

test("bg-tasks kill route is a POST and maps package errors onto HTTP statuses", () => {
  assert.match(killSource, /export async function POST/);
  assert.match(killSource, /bgOperationFailureStatus\(result\.error\)/);
  assert.match(killSource, /bridge\.kill\(taskId\)/);
  assert.match(killSource, /pi-background-tasks bridge is not attached/);
  assert.doesNotMatch(killSource, /export async function GET/);
});

test("every bg-tasks route answers unavailable JSON instead of erroring without the package", () => {
  for (const [name, source] of [["list", listSource], ["logs", logsSource], ["kill", killSource]]) {
    assert.match(source, /status: 503/, `${name} route must degrade with 503`);
    assert.match(source, /NextResponse\.json\(\s*\{ error:/, `${name} route must return a JSON error body`);
  }
});
