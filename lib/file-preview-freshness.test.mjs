import assert from "node:assert/strict";
import test from "node:test";
import { fetchLiveFile, nextFilePreviewVersion, onFilePreviewRefresh, requestFilePreviewRefresh } from "./file-preview-freshness.ts";

test("new media loads have unique versions even across viewer remounts", () => {
  const versions = Array.from({ length: 100 }, nextFilePreviewVersion);
  assert.equal(new Set(versions).size, versions.length);
});

test("live reads bypass HTTP caches without dropping cancellation or headers", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/files/report?type=read");
      assert.equal(init.cache, "no-store");
      assert.equal(init.signal, controller.signal);
      assert.deepEqual(init.headers, { Accept: "application/json" });
      return new Response("ok");
    };
    await fetchLiveFile("/api/files/report?type=read", { cache: "force-cache", signal: controller.signal, headers: { Accept: "application/json" } });
  } finally { globalThis.fetch = original; }
});

test("reopen checks only the named file; focus and visibility checks stop on cleanup", () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  try {
    globalThis.window = new EventTarget();
    globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    let checks = 0;
    const remove = onFilePreviewRefresh("/report.md", () => checks++);
    requestFilePreviewRefresh("/other.md");
    assert.equal(checks, 0);
    requestFilePreviewRefresh("/report.md");
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(checks, 3);
    document.visibilityState = "hidden";
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(checks, 3);
    remove();
    document.visibilityState = "visible";
    requestFilePreviewRefresh("/report.md");
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(checks, 3);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});
