import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  PROCESS_CONTENT_EVENT,
  isProcessContentVisible,
  setProcessContentVisible,
} = await jiti.import("./process-content-preference.ts");

function installWindow(initial = {}) {
  const values = new Map(Object.entries(initial));
  const listeners = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: (event) => {
      listeners.get(event.type)?.(event);
      return true;
    },
  };
  return values;
}

test("keeps process content hidden by default", () => {
  installWindow();
  assert.equal(isProcessContentVisible(), false);
});

test("persists process content visibility and notifies mounted chats", () => {
  const values = installWindow();
  let notified = 0;
  window.addEventListener(PROCESS_CONTENT_EVENT, () => notified++);

  setProcessContentVisible(true);

  assert.equal(isProcessContentVisible(), true);
  assert.equal(values.get("pi-web:chat:show-process-content"), "true");
  assert.equal(notified, 1);
});
