import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const { useProjectDev } = await jiti.import("./useProjectDev.ts");
const info = (cwd, status = "stopped") => ({ cwd, found: true, configError: null, processes: [{ name: "web", command: "npm run dev" }], status, error: null });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const inspected = (cwd, status) => json({ projects: [{ requestedCwd: cwd, info: info(cwd, status) }] });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function settle(hook) {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
  hook.flush();
}
function environment(t) {
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const mounted = [];
  t.after(() => {
    for (const hook of mounted) hook.unmount();
    delete globalThis.window;
    delete globalThis.document;
  });
  return (hook) => { mounted.push(hook); return hook; };
}

test("a late poll cannot undo a completed start, and repeated clicks send one command", async (t) => {
  const mount = environment(t);
  const poll = deferred();
  const start = deferred();
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1) return poll.promise;
    if (body.action === "start") return start.promise;
    return inspected("/repo", "running");
  };
  const hook = mount(renderHook(useProjectDev, ["/repo"]));
  const started = hook.result.control("/repo", "start");
  await hook.result.control("/repo", "start");
  hook.flush();
  assert.equal(hook.result.busy("/repo"), true);
  assert.equal(requests.filter((item) => item.action === "start").length, 1);
  start.resolve(json(info("/repo", "running")));
  await started;
  hook.flush();
  assert.equal(hook.result.projects["/repo"].status, "running");
  poll.resolve(inspected("/repo", "stopped"));
  await settle(hook);
  assert.equal(hook.result.projects["/repo"].status, "running");
  assert.equal(hook.result.busy("/repo"), false);
  assert.ok(requests.filter((item) => item.action === "inspect").length >= 2, "refresh queued behind the stale poll");
});

test("a response for the previous project list is discarded after a switch", async (t) => {
  const mount = environment(t);
  const old = deferred();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return body.cwds.includes("/old") ? old.promise : inspected("/new", "running");
  };
  const hook = mount(renderHook(useProjectDev, ["/old"]));
  hook.rerender(["/new"]);
  await settle(hook);
  old.resolve(inspected("/old", "stopped"));
  await settle(hook);
  assert.equal(hook.result.projects["/new"].status, "running");
  assert.equal(hook.result.projects["/old"], undefined);
});

test("a refused command clears its pending state and refreshes server status", async (t) => {
  const mount = environment(t);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return body.action === "inspect" ? inspected("/repo", "stopped") : json({ error: "invalid Procfile" }, 400);
  };
  const hook = mount(renderHook(useProjectDev, ["/repo"]));
  await settle(hook);
  await assert.rejects(hook.result.control("/repo", "start"), /invalid Procfile/);
  await settle(hook);
  assert.equal(hook.result.busy("/repo"), false);
  assert.equal(hook.result.projects["/repo"].status, "stopped");
});
