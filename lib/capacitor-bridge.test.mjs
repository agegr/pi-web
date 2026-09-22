import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./capacitor-bridge.ts");
}

test("module imports cleanly in Node (SSR-safe, nothing eager at module scope)", async () => {
  const mod = await loadSubject();
  assert.equal(typeof mod.isCapacitorShell, "function");
  assert.equal(typeof mod.getCapacitorCamera, "function");
  assert.equal(typeof mod.getCapacitorFilePicker, "function");
  assert.equal(typeof mod.getCapacitorLocalNotifications, "function");
  assert.equal(typeof mod.getCapacitorKeyboard, "function");
  assert.equal(typeof mod.getCapacitorPreferences, "function");
  // No import-time DOM access: none of these threw and `window` is untouched.
  assert.equal(typeof globalThis.window, "undefined");
});

test("detection is false without a bridge and accessors return null", async () => {
  const { isCapacitorShell, getCapacitorCamera, getCapacitorFilePicker, getCapacitorLocalNotifications, getCapacitorKeyboard, getCapacitorPreferences } = await loadSubject();

  assert.equal(isCapacitorShell(), false);
  assert.equal(getCapacitorCamera(), null);
  assert.equal(getCapacitorFilePicker(), null);
  assert.equal(getCapacitorLocalNotifications(), null);
  assert.equal(getCapacitorKeyboard(), null);
  assert.equal(getCapacitorPreferences(), null);
});

test("a browser-like window without Capacitor behaves exactly like SSR", async () => {
  const { isCapacitorShell, applyCapacitorShellScenario } = await loadSubject();
  globalThis.window = { navigator: { userAgent: "mozilla" } };
  try {
    assert.equal(isCapacitorShell(), false);
    // Scenario setup is a no-op outside the shells.
    const classes = new Set();
    const doc = { documentElement: { classList: { add: (c) => classes.add(c) } } };
    applyCapacitorShellScenario(doc);
    assert.equal(classes.size, 0);
  } finally {
    delete globalThis.window;
  }
});

test("inside a shell, accessors lazily reach the injected plugin proxies", async () => {
  const { isCapacitorShell, getCapacitorCamera, getCapacitorFilePicker, getCapacitorLocalNotifications, getCapacitorPreferences, applyCapacitorShellScenario, CAPACITOR_SHELL_SCENARIO_CLASS } = await loadSubject();

  const camera = { getPhoto: async () => ({ base64String: "aGk=" }) };
  const preferences = { set: async () => {} };
  globalThis.window = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        Camera: camera,
        Preferences: preferences,
        // FilePicker / LocalNotifications intentionally absent → materialized
        // through registerPlugin below (Capacitor 7 has no lazy Plugins proxy).
      },
      registerPlugin: (name, impls) => {
        const proxy = { materializedFor: name, impls };
        return proxy;
      },
    },
  };
  try {
    assert.equal(isCapacitorShell(), true);
    assert.equal(getCapacitorCamera(), camera);
    assert.equal(getCapacitorPreferences(), preferences);
    assert.equal(getCapacitorFilePicker().materializedFor, "FilePicker");
    assert.equal(getCapacitorLocalNotifications().materializedFor, "LocalNotifications");

    const classes = new Set();
    applyCapacitorShellScenario({ documentElement: { classList: { add: (c) => classes.add(c) } } });
    assert.deepEqual([...classes], [CAPACITOR_SHELL_SCENARIO_CLASS]);
  } finally {
    delete globalThis.window;
  }
});

test("a shell runtime without registerPlugin yields null for material plugins only", async () => {
  const { getCapacitorFilePicker, getCapacitorCamera } = await loadSubject();
  const camera = { getPhoto: async () => ({}) };
  globalThis.window = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Camera: camera }, registerPlugin: undefined },
  };
  try {
    // Registered plugins still resolve; unregistered ones cannot be created.
    assert.equal(getCapacitorCamera(), camera);
    assert.equal(getCapacitorFilePicker(), null);
  } finally {
    delete globalThis.window;
  }
});

test("isPermissionDeniedError matches denials but not user cancellation", async () => {
  const { isPermissionDeniedError } = await loadSubject();
  assert.equal(isPermissionDeniedError(new Error("User denied access to camera")), true);
  assert.equal(isPermissionDeniedError("Permission denied"), true);
  assert.equal(isPermissionDeniedError("camera not authorized"), true);
  assert.equal(isPermissionDeniedError("User cancelled"), false);
  assert.equal(isPermissionDeniedError(new Error("cancelled")), false);
  assert.equal(isPermissionDeniedError(null), false);
  assert.equal(isPermissionDeniedError(undefined), false);
});

test("fileFromCameraPhoto converts base64 capture into a submit-ready File", async () => {
  const { fileFromCameraPhoto } = await loadSubject();
  const file = fileFromCameraPhoto("aGVsbG8=", "jpeg");
  assert.ok(file instanceof File);
  assert.equal(file.type, "image/jpeg");
  assert.match(file.name, /^camera-\d+\.jpeg$/);
  assert.equal(await file.text(), "hello");

  const png = fileFromCameraPhoto("aGVsbG8=", "png");
  assert.equal(png.type, "image/png");
  assert.ok(png.name.endsWith(".png"));
});

test("filesFromPickedFiles keeps readable picks and derives upload names", async () => {
  const { filesFromPickedFiles } = await loadSubject();
  const blob = new Blob(["abc"], { type: "text/plain" });
  // Native results: base64 `data` (readData: true) + name/mimeType/path.
  const files = filesFromPickedFiles([
    { data: "aGVsbG8=", name: "notes.md", mimeType: "text/markdown", path: "content://x/notes.md", size: 5 },
    { blob, path: "/storage/emulated/0/Download/report.pdf", mimeType: "application/pdf", size: 3 },
    { data: "aGVsbG8=" }, // no name hints at all
    { name: "unreadable.txt", mimeType: "text/plain" }, // no blob and no data → skipped
  ]);
  assert.equal(files.length, 3);
  assert.equal(files[0].name, "notes.md");
  assert.equal(files[0].type, "text/markdown");
  assert.equal(await files[0].text(), "hello");
  assert.equal(files[1].name, "report.pdf");
  assert.equal(files[1].type, "application/pdf");
  assert.match(files[2].name, /^upload-\d+-3$/);
  assert.equal(await files[2].text(), "hello");
});

test("fileFromGalleryWebPath is gone: gallery picks ride the bridge as base64 (CORS finding)", async () => {
  const mod = await loadSubject();
  assert.equal(mod.fileFromGalleryWebPath, undefined);
});

test("LocalNotifications scheduling uses the official { notifications: [...] } envelope (pi#31 review fix)", async () => {
  const scheduled = [];
  globalThis.window = {
    navigator: { userAgent: "mozilla" },
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {
        LocalNotifications: {
          schedule: async (options) => {
            scheduled.push(options);
            return { notifications: [] };
          },
        },
      },
    },
  };
  try {
    // jiti so browser-notifications' extensionless ./capacitor-bridge import resolves.
    const { createJiti } = await import("jiti");
    const notifications = await createJiti(import.meta.url).import("./browser-notifications.ts");
    const delivery = await notifications.showBrowserNotification({
      title: "Session complete",
      body: "Task finished.",
      sessionUrl: "/?session=session-1",
    });
    assert.equal(delivery, "local-notifications");
    assert.equal(scheduled.length, 1);
    // The native implementations reject a flat payload; the envelope is mandatory.
    assert.ok(Array.isArray(scheduled[0].notifications), "schedule must receive a notifications array");
    const first = scheduled[0].notifications[0];
    assert.equal(typeof first.id, "number");
    assert.equal(first.title, "Session complete");
    assert.equal(first.body, "Task finished.");
    assert.deepEqual(first.extra, { sessionUrl: "/?session=session-1" });
  } finally {
    delete globalThis.window;
  }
});
