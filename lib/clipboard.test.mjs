import assert from "node:assert/strict";
import test from "node:test";

import { copyText } from "./clipboard.ts";

/**
 * Stands in for the browser globals `copyText` reaches for, and records what the
 * fallback path did with them. `navigator.clipboard` is left off for the
 * fallback cases: a page that is not a secure context does not have it, which is
 * exactly the environment the fallback exists for.
 */
function stubDom({ execResult, throwOnExec = false, clipboard } = {}) {
  const calls = { select: 0, exec: [], appended: 0, removed: 0 };
  const textarea = {
    value: "",
    style: {},
    select: () => { calls.select += 1; },
    remove: () => { calls.removed += 1; },
  };
  const previous = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  };
  // Node 24 exposes `navigator` as a getter-only global, so plain assignment
  // throws; define both names instead and put their descriptors back afterwards.
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("navigator", clipboard ? { clipboard } : {});
  define("document", {
    createElement: (tag) => {
      assert.equal(tag, "textarea");
      return textarea;
    },
    body: {
      appendChild: () => { calls.appended += 1; },
    },
    execCommand: (command) => {
      calls.exec.push(command);
      if (throwOnExec) throw new Error("execCommand is gone");
      return execResult;
    },
  });
  return {
    calls,
    textarea,
    restore: () => {
      for (const [name, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test("a secure context hands the text to the async clipboard and touches no textarea", async () => {
  const handed = [];
  const dom = stubDom({ clipboard: { writeText: (text) => { handed.push(text); return Promise.resolve(); } } });
  try {
    await copyText("hello");
  } finally {
    dom.restore();
  }
  assert.deepEqual(handed, ["hello"]);
  assert.equal(dom.calls.exec.length, 0);
});

test("a non-secure context copies through the textarea fallback", async () => {
  const dom = stubDom({ execResult: true });
  try {
    await copyText("whole file");
  } finally {
    dom.restore();
  }
  assert.equal(dom.textarea.value, "whole file");
  assert.equal(dom.calls.select, 1);
  assert.deepEqual(dom.calls.exec, ["copy"]);
  assert.equal(dom.calls.appended, 1);
  assert.equal(dom.calls.removed, 1);
});

test("a refused fallback copy rejects instead of claiming success", async () => {
  // The browser can say no even without `navigator.clipboard`: no user
  // activation, a locked-down platform. Reporting success here made the caller's
  // "Copied" a lie, and nothing on screen said the text never left the page.
  const dom = stubDom({ execResult: false });
  try {
    await assert.rejects(copyText("refused"), /refused/i);
  } finally {
    dom.restore();
  }
  // The textarea is gone before the rejection travels: no hidden node stays behind.
  assert.equal(dom.calls.removed, 1);
});

test("a throwing fallback copy rejects with the browser's error", async () => {
  const dom = stubDom({ throwOnExec: true });
  try {
    await assert.rejects(copyText("boom"), /execCommand is gone/);
  } finally {
    dom.restore();
  }
  assert.equal(dom.calls.removed, 1);
});
