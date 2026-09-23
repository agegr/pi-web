import assert from "node:assert/strict";
import test from "node:test";
import { copyText } from "./clipboard.ts";

test("clipboard rejects denied copies and always cleans up the legacy fallback", async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldDocument = globalThis.document;
  t.after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  });
  let copied, removed = 0, focused = 0, modalCopies = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    clipboard: { writeText: async (text) => { copied = text; } },
  } });
  await copyText("中文\nmarkdown");
  assert.equal(copied, "中文\nmarkdown");
  navigator.clipboard.writeText = async () => { throw Error("denied"); };
  await assert.rejects(copyText("x"), /denied/);
  delete navigator.clipboard;
  globalThis.document = {
    activeElement: { focus: () => focused++, closest: () => ({ appendChild: () => modalCopies++ }) },
    createElement: () => ({ style: {}, select() {}, remove: () => removed++ }),
    body: { appendChild() {} }, execCommand: () => false,
  };
  await assert.rejects(copyText("x"), /denied/);
  document.execCommand = () => true;
  await copyText("x");
  assert.equal(removed, 2); assert.equal(focused, 2); assert.equal(modalCopies, 2);
});
