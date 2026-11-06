import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
      removeChild: () => { calls.removed += 1; },
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
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRS = ["app", "components", "hooks", "lib"];

/** Every .ts/.tsx source under the app's own folders, tests and declarations left out. */
function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) files.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) walk(path.join(repoRoot, dir));
  return files;
}

/**
 * The end of the statement holding `from`: the first `;` outside any brace
 * the statement opens, or the `}` closing the block it sits in. Parentheses are
 * not counted, so a call nested inside an outer `.then(...)` still reaches the
 * end of the whole chain it belongs to.
 */
function statementEnd(source, from) {
  let braces = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") braces++;
    else if (ch === "}") {
      if (braces === 0) return i;
      braces--;
    } else if (ch === ";" && braces === 0) return i;
  }
  return source.length;
}

/** Whether the call whose `(` sits at `open` passes a second top-level argument. */
function hasSecondArgument(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      depth--;
      if (depth === 0) return false;
    } else if (ch === "," && depth === 1) {
      // A trailing comma before `)` is not an argument.
      return !/^\s*\)/.test(source.slice(i + 1));
    }
  }
  return false;
}

test("every copyText caller handles a refused copy", () => {
  // copyText rejects when the browser refuses the copy (most often a page that is
  // not a secure context). A caller chaining only a success handler turns that
  // into an unhandled rejection: `next dev` raises its Runtime Error overlay over
  // the page, production logs it, and the button shows nothing either way.
  const calls = [];
  for (const file of sourceFiles()) {
    if (file === path.join(repoRoot, "lib", "clipboard.ts")) continue;
    const source = readFileSync(file, "utf8");
    if (!source.includes("@/lib/clipboard")) continue;
    for (const match of source.matchAll(/\bcopyText\(/g)) {
      const end = statementEnd(source, match.index);
      const chain = source.slice(match.index, end);
      let handled = /\.catch\(/.test(chain);
      for (const then of chain.matchAll(/\.then\(/g)) {
        if (hasSecondArgument(source, match.index + then.index + then[0].length - 1)) handled = true;
      }
      const line = source.slice(0, match.index).split("\n").length;
      calls.push({ where: `${path.relative(repoRoot, file)}:${line}`, handled });
    }
  }
  // Guards the scan itself: a walk that found no files would pass without
  // checking anything. The number is the copy actions the app ships today.
  assert.ok(calls.length >= 7, `expected at least 7 copyText calls, found ${calls.length}`);
  const unhandled = calls.filter((call) => !call.handled).map((call) => call.where);
  assert.deepEqual(
    unhandled,
    [],
    "pass a rejection handler, e.g. `copyText(x).then(onCopied, () => {})`, or end the chain with .catch()",
  );
});
