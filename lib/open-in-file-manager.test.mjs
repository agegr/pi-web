import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  fileManagerCommand,
  fileManagerFocusCommand,
  isFileManagerSupported,
  isLoopbackHost,
  launchFileManager,
  normalizeExplorerLocationUrl,
  shouldFocusFileManager,
  windowsFocusScript,
} = await jiti.import("./open-in-file-manager.ts");

/** Reads the script back out of the PowerShell command line. */
function decodeFocusScript(spec) {
  const encoded = spec.args[spec.args.indexOf("-EncodedCommand") + 1];
  return Buffer.from(encoded, "base64").toString("utf16le");
}

test("maps each platform to its file manager command", () => {
  assert.deepEqual(fileManagerCommand("win32", "D:\\work\\repo"), {
    command: "explorer.exe",
    args: ["D:\\work\\repo"],
  });
  assert.deepEqual(fileManagerCommand("darwin", "/Users/dev/repo"), {
    command: "open",
    args: ["/Users/dev/repo"],
  });
  assert.deepEqual(fileManagerCommand("linux", "/home/dev/repo"), {
    command: "xdg-open",
    args: ["/home/dev/repo"],
  });
});

test("reports platforms without a file manager command", () => {
  assert.equal(isFileManagerSupported("win32"), true);
  assert.equal(isFileManagerSupported("darwin"), true);
  assert.equal(isFileManagerSupported("linux"), true);
  assert.equal(isFileManagerSupported("aix"), false);
  assert.equal(isFileManagerSupported("hasOwnProperty"), false);
  assert.equal(fileManagerCommand("aix", "/tmp"), null);
});

test("treats loopback host headers as local", () => {
  assert.equal(isLoopbackHost("localhost:30141"), true);
  assert.equal(isLoopbackHost("LOCALHOST"), true);
  assert.equal(isLoopbackHost("127.0.0.1:30141"), true);
  assert.equal(isLoopbackHost("127.31.9.2"), true);
  assert.equal(isLoopbackHost("[::1]:30141"), true);
  assert.equal(isLoopbackHost("pi-web.localhost"), true);
});

test("treats LAN, public, and missing hosts as remote", () => {
  assert.equal(isLoopbackHost("192.168.1.20:30141"), false);
  assert.equal(isLoopbackHost("10.0.0.5"), false);
  assert.equal(isLoopbackHost("pi-web.example.com"), false);
  assert.equal(isLoopbackHost("[fe80::1]:30141"), false);
  assert.equal(isLoopbackHost("127.0.0.1.example.com"), false);
  assert.equal(isLoopbackHost(""), false);
  assert.equal(isLoopbackHost(null), false);
  assert.equal(isLoopbackHost(undefined), false);
});

test("refuses to launch on platforms without a file manager", async () => {
  await assert.rejects(launchFileManager("/tmp", "aix"), /Unsupported platform: aix/);
});

test("compares explorer locations by decoded, case-folded path", () => {
  assert.equal(normalizeExplorerLocationUrl("file:///C:/Work/Repo/"), "file:///c:/work/repo");
  assert.equal(normalizeExplorerLocationUrl("file:///C:/Program%20Files/x"), "file:///c:/program files/x");
  // Not valid percent-encoding must not throw, only compare as written.
  assert.equal(normalizeExplorerLocationUrl("file:///C:/100%/"), "file:///c:/100%");
});

test("only Explorer needs its window raised afterwards", () => {
  assert.equal(fileManagerFocusCommand("darwin", "/tmp"), null);
  assert.equal(fileManagerFocusCommand("linux", "/tmp"), null);
  assert.equal(fileManagerFocusCommand("aix", "/tmp"), null);
  const spec = fileManagerFocusCommand("win32", "D:\\work\\repo");
  assert.equal(spec.command, "powershell.exe");
  assert.ok(spec.args.includes("-NoProfile"));
  assert.ok(spec.args.includes("Hidden"));
});

test("the raise helper waits for the folder window and brings it forward", () => {
  const target = "D:\\work\\my repo";
  const script = decodeFocusScript(fileManagerFocusCommand("win32", target));
  // The expected location is the normalized form of the folder, so the helper
  // compares it with Explorer's own LocationURL spelling.
  assert.match(script, new RegExp(`\\$expected = '${normalizeExplorerLocationUrl(pathToFileURL(target).href).replace(/'/g, "''")}'`));
  assert.match(script, /LocationURL/);
  assert.match(script, /for \(\$attempt = 0; \$attempt -lt \d+; \$attempt\+\+\)/);
  assert.match(script, /IsIconic\(\$hwnd\)/);
  assert.match(script, /ShowWindow\(\$hwnd, 9\)/);
  // A maximized window must survive the helper untouched: SW_RESTORE would
  // shrink it, so the restore runs only when the window is actually minimized.
  assert.match(script, /if \(\[PiWeb\.WindowFocus\]::IsIconic\(\$hwnd\)\) \{ \[PiWeb\.WindowFocus\]::ShowWindow\(\$hwnd, 9\)/);
  // The window has to move in the z-order: a server the user never clicked on
  // cannot take the foreground, so raising the window is what actually helps.
  assert.match(script, /SetWindowPos\(\$hwnd, \[IntPtr\]\(-1\), 0, 0, 0, 0, 0x43\)/);
  assert.match(script, /SetWindowPos\(\$hwnd, \[IntPtr\]\(-2\), 0, 0, 0, 0, 0x53\)/);
  assert.match(script, /SetForegroundWindow\(\$hwnd\)/);
  // The window must not be left pinned: the topmost flag is dropped again, and
  // the gap it stays set for is short, because a helper killed inside that gap
  // would leave the folder above every window until it is closed.
  const gap = /SetWindowPos\(\$hwnd, \[IntPtr\]\(-1\).*?Start-Sleep -Milliseconds (\d+)\s.*?SetWindowPos\(\$hwnd, \[IntPtr\]\(-2\)/s.exec(script);
  assert.ok(gap, "the topmost flag has to be dropped again");
  assert.ok(Number(gap[1]) <= 100, `topmost gap of ${gap[1]}ms is long enough to strand a pinned window`);
});

test("a folder whose name would end the PowerShell string survives it", () => {
  const script = windowsFocusScript("D:\\work\\it's here");
  assert.match(script, /\$expected = '.*it''s here'/);
});

test("raising the window follows the platform and can be switched off", () => {
  assert.equal(shouldFocusFileManager("win32", {}), true);
  assert.equal(shouldFocusFileManager("darwin", {}), false);
  assert.equal(shouldFocusFileManager("aix", {}), false);
  assert.equal(shouldFocusFileManager("win32", { PI_WEB_FILE_MANAGER_FOCUS: "0" }), false);
  assert.equal(shouldFocusFileManager("win32", { PI_WEB_FILE_MANAGER_FOCUS: "false" }), false);
  assert.equal(shouldFocusFileManager("win32", { PI_WEB_FILE_MANAGER_FOCUS: "1" }), true);
});
