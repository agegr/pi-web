import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./browser-notifications.ts");
}

test("uses a service worker notification when a registration is available", async () => {
  const { showCompletionNotification } = await loadSubject();
  const shown = [];
  let constructorCalled = false;

  const delivery = await showCompletionNotification({
    title: "Session complete",
    body: "Task finished.",
    sessionUrl: "/?session=session-1",
    onClick: () => assert.fail("service worker owns the click handler"),
  }, {
    createWindowNotification: () => {
      constructorCalled = true;
      throw new Error("unexpected constructor call");
    },
    getServiceWorkerRegistration: async () => ({
      showNotification: async (title, options) => shown.push({ title, options }),
    }),
  });

  assert.equal(delivery, "service-worker");
  assert.equal(constructorCalled, false);
  assert.deepEqual(shown, [{
    title: "Session complete",
    options: {
      body: "Task finished.",
      data: { url: "/?session=session-1" },
    },
  }]);
});

test("falls back to a page notification and wires its click handler", async () => {
  const { showCompletionNotification } = await loadSubject();
  let notificationOptions;
  let clicked = false;
  let closed = false;
  const notification = {
    onclick: null,
    close: () => { closed = true; },
  };

  const delivery = await showCompletionNotification({
    title: "Session complete",
    body: "Task finished.",
    sessionUrl: "/?session=session-1",
    onClick: () => { clicked = true; },
  }, {
    createWindowNotification: (title, options) => {
      notificationOptions = { title, options };
      return notification;
    },
    getServiceWorkerRegistration: async () => {
      throw new Error("service worker unavailable");
    },
  });

  assert.equal(delivery, "window");
  assert.deepEqual(notificationOptions, {
    title: "Session complete",
    options: { body: "Task finished." },
  });

  notification.onclick();
  assert.equal(closed, true);
  assert.equal(clicked, true);
});

test("silently skips notification when neither delivery mechanism works", async () => {
  const { showCompletionNotification } = await loadSubject();

  const delivery = await showCompletionNotification({
    title: "Session complete",
    body: "Task finished.",
    sessionUrl: "/",
    onClick: () => {},
  }, {
    createWindowNotification: () => {
      throw new TypeError("Illegal constructor");
    },
    getServiceWorkerRegistration: null,
  });

  assert.equal(delivery, null);
});
