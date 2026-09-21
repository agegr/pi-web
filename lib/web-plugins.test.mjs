import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { WebPluginRuntime } = await jiti.import("./web-plugins-server.ts");
const { WebPluginClientRuntime } = await jiti.import("./web-plugins-client.ts");
const { validWebPluginHint } = await jiti.import("./web-plugin-types.ts");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-plugins-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new WebPluginRuntime();
  t.after(() => runtime.dispose());
  const create = async (id, manifest = {}, server = "") => {
    const dir = join(root, id);
    await mkdir(dir);
    await writeFile(join(dir, "pi-web-plugin.json"), JSON.stringify({ id, apiVersion: 1, client: "client.mjs", ...manifest }));
    await writeFile(join(dir, "client.mjs"), "export function activate(api) {} // PUBLIC CLIENT");
    if (server) await writeFile(join(dir, "server.mjs"), server);
    return { path: dir, enabled: true };
  };
  const load = async (plugins) => {
    const path = join(root, "settings.json");
    await writeFile(path, JSON.stringify({ plugins }));
    await runtime.load(path);
  };
  return { root, runtime, create, load };
}

test("explicit opt-in, version gate, namespaced routes, isolated events and idempotent cleanup", async (t) => {
  const { root, runtime, create, load } = await fixture(t);
  const disposedFile = join(root, "disposed.txt");
  const good = await create("demo", { server: "server.mjs" }, `
    import { writeFileSync } from 'node:fs';
    export function activate(api) {
      let count = 0;
      api.onSessionEvent('agent_end', ({event}) => { event.mutated = true; count++; });
      api.onSessionEvent('agent_end', ({event}) => { if (event.mutated) throw Error('snapshot leak'); });
      api.registerRoute('count', () => Response.json({count}));
      api.registerRoute('fail', () => { throw Error('PRIVATE SERVER DETAIL'); });
      api.onDispose(() => writeFileSync(${JSON.stringify(disposedFile)}, 'disposed'));
    }
  `);
  const off = await create("off"); off.enabled = false;
  const implicit = await create("implicit"); delete implicit.enabled;
  const wrong = await create("wrong", { apiVersion: 2 });
  await load([good, off, implicit, wrong]);
  assert.deepEqual(runtime.descriptors().map(p => p.id), ["demo"]);
  assert.equal(runtime.errors.length, 1);
  assert.ok(!JSON.stringify(runtime.descriptors()).includes(root));
  const event = { type: "agent_end" };
  runtime.publish("session-1", event);
  assert.equal(event.mutated, undefined);
  const req = new Request("http://plugins.localhost/api/web-plugins/demo/rpc/count");
  assert.deepEqual(await (await runtime.dispatch("demo", "rpc/count", req)).json(), { count: 1 });
  assert.equal((await runtime.dispatch("off", "client", req)).status, 404);
  for (const route of ["server.mjs", "../server.mjs", "rpc/../count", "rpc/missing"]) {
    assert.equal((await runtime.dispatch("demo", route, req)).status, 404);
  }
  const client = await runtime.dispatch("demo", "client", req);
  assert.match(await client.text(), /PUBLIC CLIENT/);
  assert.equal(client.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await runtime.dispatch("demo", "client", new Request(req, { method: "POST" }))).status, 405);
  const error = await runtime.dispatch("demo", "rpc/fail", req);
  assert.equal(error.status, 500);
  assert.ok(!(await error.text()).includes("PRIVATE"));
  await runtime.dispose(); await runtime.dispose();
  assert.deepEqual(runtime.descriptors(), []);
  assert.equal(await (await import("node:fs/promises")).readFile(disposedFile, "utf8"), "disposed");
});

test("path traversal, symlink escapes, duplicate ids and partial activation fail closed", async (t) => {
  const { root, runtime, create, load } = await fixture(t);
  await writeFile(join(root, "outside.mjs"), "throw Error('MUST NOT EXECUTE')");
  const traversal = await create("traversal", { client: "../outside.mjs" });
  const link = await create("link", { client: "link.mjs" });
  await symlink(join(root, "outside.mjs"), join(link.path, "link.mjs"));
  const partial = await create("partial", { server: "server.mjs" }, `export function activate(api) {
    api.registerRoute('leaked', () => new Response('bad'));
    throw Error('activation failure');
  }`);
  const good = await create("good");
  await load([traversal, link, partial, good, good]);
  assert.deepEqual(runtime.descriptors().map(p => p.id), ["good"]);
  assert.equal(runtime.errors.length, 4);
  assert.equal((await runtime.dispatch("partial", "rpc/leaked", new Request("http://plugins.localhost"))).status, 404);
});

test("browser registration rolls back failures, cleans up once and checks route names", async () => {
  const runtime = new WebPluginClientRuntime();
  let cleaned = 0, api;
  await assert.rejects(runtime.activate({ id: "broken" }, (host) => {
    host.registerSlot("chat-toolbar", { mount() {} });
    host.onDispose(() => cleaned++);
    throw Error("broken");
  }));
  assert.equal(runtime.slots.length, 0);
  assert.equal(cleaned, 1);
  await runtime.activate({ id: "good" }, (host) => {
    api = host;
    host.registerSlot("extension-dialog", { mount() {} });
    host.onDispose(() => cleaned++);
  });
  assert.equal(runtime.slots.length, 1);
  await assert.rejects(api.request("../auth"));
  assert.throws(() => api.registerSlot("chat-toolbar", { mount() {} }), /closed/);
  runtime.dispose(); runtime.dispose();
  assert.equal(cleaned, 2);
  await assert.rejects(api.request("count"));
});

test("editor hint validates protocol fields rather than forwarding arbitrary options", () => {
  assert.deepEqual(validWebPluginHint({ plugin: "demo-editor", view: "preview", secret: "not forwarded" }), { plugin: "demo-editor", view: "preview" });
  for (const hint of [null, "x", { plugin: "../x", view: "trace" }, { plugin: "x", view: 42 }]) assert.equal(validWebPluginHint(hint), undefined);
});
