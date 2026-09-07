import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { ImageAttachmentStore } = await jiti.import("./image-materialization.ts");
const png = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-rpc-images-"));
  const previous = globalThis.__piImageAttachmentStore;
  const store = new ImageAttachmentStore({ root });
  globalThis.__piImageAttachmentStore = store;
  const calls = [];
  const capture = async (message, images) => {
    const paths = [...message.matchAll(/^\d+\. (".*")$/gm)].map(match => JSON.parse(match[1]));
    assert.equal(paths.length, images?.length);
    for (const path of paths) assert.deepEqual(await readFile(path), Buffer.from(png.data, "base64"));
    calls.push({ message, images, paths });
  };
  const inner = {
    sessionId: "image-test", sessionManager: { getCwd: () => root },
    isStreaming: false, isCompacting: false, isBashRunning: false,
    agent: { state: {} }, extensionRunner: {}, dispose() {},
    prompt: async (message, options) => {
      await capture(message, options.images);
      options.preflightResult(true);
    },
    steer: capture, followUp: capture,
    ...overrides,
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(async () => {
    wrapper.destroy();
    store.disposeSync();
    globalThis.__piImageAttachmentStore = previous;
    await rm(root, { recursive: true, force: true });
  });
  return { wrapper, calls, root, store, inner };
}

for (const command of [
  { type: "prompt" }, { type: "prompt", streamingBehavior: "steer" },
  { type: "prompt", streamingBehavior: "followUp" }, { type: "steer" }, { type: "follow_up" },
]) test(`provides readable paths and unchanged images for ${JSON.stringify(command)}`, async (t) => {
  const { wrapper, calls } = await fixture(t);
  const images = [png, png];
  await wrapper.send({ ...command, message: "Inspect these", images });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].images, images);
  assert.ok(calls[0].message.startsWith("Inspect these"));
  const reader = createReadTool(tmpdir(), { autoResizeImages: false });
  const result = await reader.execute("read-fixture", { path: calls[0].paths[0] });
  assert.ok(result.content.some(block => block.type === "image" && block.mimeType === "image/png"));
  wrapper.destroy();
  assert.deepEqual(await readFile(calls[0].paths[0]), Buffer.from(png.data, "base64"));
});

test("rejected preflight rolls back only its own image batch", async (t) => {
  let rejectedPath;
  const { wrapper, store } = await fixture(t, {
    prompt: async (message, options) => {
      rejectedPath = JSON.parse(message.match(/^1\. (".*")$/m)[1]);
      assert.ok((await stat(rejectedPath)).isFile());
      options.preflightResult(false);
      throw new Error("fixture rejected");
    },
  });
  const kept = await store.materialize([png]);
  await assert.rejects(wrapper.send({ type: "prompt", message: "reject", images: [png] }), /fixture rejected/);
  await assert.rejects(stat(rejectedPath), { code: "ENOENT" });
  assert.ok((await stat(kept.paths[0])).isFile());
  assert.equal((await readdir(dirname(dirname(kept.paths[0])))).length, 1);
});

test("failure after acceptance retains files referenced by the accepted message", async (t) => {
  let path;
  let fail;
  const { wrapper } = await fixture(t, {
    prompt: (message, options) => {
      path = JSON.parse(message.match(/^1\. (".*")$/m)[1]);
      options.preflightResult(true);
      return new Promise((_, reject) => { fail = reject; });
    },
  });
  await wrapper.send({ type: "prompt", message: "accepted", images: [png] });
  fail(new Error("fixture provider failure"));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok((await stat(path)).isFile());
});

test("text-only prompts are unchanged and allocate no image files", async (t) => {
  let received;
  const { wrapper, root } = await fixture(t, { prompt: async (message, options) => {
    received = message;
    assert.equal(options.images, undefined);
    options.preflightResult(true);
  } });
  await wrapper.send({ type: "prompt", message: "/command" });
  assert.equal(received, "/command");
  assert.deepEqual(await readdir(root), []);
});
