import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { injectSandboxedHtmlPolyfill, SANDBOX_STORAGE_POLYFILL_SCRIPT } from "./html-sandbox-polyfill.ts";

function runPreviewScript(window) {
  const html = injectSandboxedHtmlPolyfill("<html><head></head><body></body></html>");
  const script = html.match(/<script data-pi-web-polyfill="storage">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "preview contains an executable storage shim");
  runInNewContext(script, { window });
}

function storageFromPreview() {
  const window = {};
  for (const type of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(window, type, {
      configurable: true,
      get() { throw Object.assign(new Error("opaque origin"), { name: "SecurityError" }); },
    });
  }
  runPreviewScript(window);
  return window;
}

test("injects into the real head rather than a head tag written in a comment", () => {
  const html = '<!doctype html><!-- <head> example --><html><head data-example="a>b"><script>localStorage.getItem("x")</script></head></html>';
  const preview = injectSandboxedHtmlPolyfill(html);
  assert.ok(preview.startsWith('<!doctype html><!-- <head> example --><html><head data-example="a>b"><script data-pi-web-polyfill="storage">'));
});

test("preserves the input and doctype, injects before page scripts, and is idempotent", () => {
  for (const html of [
    '<!DOCTYPE html>\n<html lang="en"><HEAD><script>first()</script></HEAD></html>',
    '<!doctype html><html><script>first()</script><body>content</body></html>',
    '<!doctype html><body><script>first()</script></body>',
    '<script>first()</script>',
  ]) {
    const preview = injectSandboxedHtmlPolyfill(html);
    assert.equal(preview.replace(SANDBOX_STORAGE_POLYFILL_SCRIPT, ""), html);
    assert.ok(preview.indexOf(SANDBOX_STORAGE_POLYFILL_SCRIPT) < preview.indexOf("<script>first()"));
    if (html.startsWith("<!")) assert.ok(preview.startsWith("<!doctype html>") || preview.startsWith("<!DOCTYPE html>"));
    assert.equal(injectSandboxedHtmlPolyfill(preview), preview);
  }
  assert.equal(injectSandboxedHtmlPolyfill(""), "");
});

test("uses native storage when available and only replaces SecurityError failures", () => {
  const localStorage = { getItem: () => "native" };
  const sessionStorage = { getItem: () => "native session" };
  const window = { localStorage, sessionStorage };
  runPreviewScript(window);
  assert.equal(window.localStorage, localStorage);
  assert.equal(window.sessionStorage, sessionStorage);

  const unavailable = {};
  const unexpected = () => { throw Object.assign(new Error("unexpected"), { name: "OtherError" }); };
  Object.defineProperty(unavailable, "localStorage", { configurable: true, get: unexpected });
  Object.defineProperty(unavailable, "sessionStorage", { configurable: true, get() { throw Object.assign(new Error(), { name: "SecurityError" }); } });
  runPreviewScript(unavailable);
  assert.equal(Object.getOwnPropertyDescriptor(unavailable, "localStorage").get, unexpected);
  unavailable.sessionStorage.setItem("works", "yes");
  assert.equal(unavailable.sessionStorage.getItem("works"), "yes");
});

test("named Storage properties interoperate with the methods", () => {
  const { localStorage } = storageFromPreview();
  localStorage.theme = "dark";
  assert.equal(localStorage.getItem("theme"), "dark");
  localStorage.setItem("count", 2);
  assert.equal(localStorage.count, "2");
  assert.equal("count" in localStorage, true);
  assert.deepEqual(Object.keys(localStorage).sort(), ["count", "theme"]);
  delete localStorage.theme;
  assert.equal(localStorage.getItem("theme"), null);
  localStorage.setItem("getItem", "stored");
  assert.equal(typeof localStorage.getItem, "function");
  assert.equal(localStorage.getItem("getItem"), "stored");
  localStorage.setItem("__proto__", "safe");
  assert.equal(localStorage.getItem("__proto__"), "safe");
  localStorage.clear();
  assert.equal(localStorage.length, 0);
  assert.deepEqual(Object.keys(localStorage), []);
});

test("Storage methods require their arguments and key converts its index like the browser", () => {
  const { localStorage } = storageFromPreview();
  assert.throws(() => localStorage.getItem(), { name: "TypeError" });
  assert.throws(() => localStorage.setItem("name"), { name: "TypeError" });
  assert.throws(() => localStorage.removeItem(), { name: "TypeError" });
  assert.throws(() => localStorage.key(), { name: "TypeError" });
  localStorage.setItem("first", "value");
  assert.equal(localStorage.key(0.5), "first");
  assert.equal(localStorage.key(2 ** 32), "first");
  assert.equal(localStorage.key(-1), null);
});

test("Storage.key returns an empty-string key rather than treating it as absent", () => {
  const { localStorage } = storageFromPreview();
  localStorage.setItem("", "value");
  assert.equal(localStorage.key(0), "");
  assert.equal(localStorage.key(1), null);
});
