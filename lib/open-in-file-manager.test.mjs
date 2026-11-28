import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  fileManagerCommand,
  fileManagerPlatform,
  fileManagerRevealCommand,
  isFileManagerSupported,
  isLoopbackHost,
  launchFileManager,
  windowsPathForWsl,
} = await jiti.import("./open-in-file-manager.ts");

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

test("reveals an entry selected in its folder, never opening it", () => {
  assert.deepEqual(fileManagerRevealCommand("darwin", "/Users/dev/repo/Tool.app"), {
    command: "open",
    args: ["-R", "/Users/dev/repo/Tool.app"],
  });
  assert.deepEqual(fileManagerRevealCommand("win32", "D:\\work\\my repo\\a.txt"), {
    command: "explorer.exe",
    args: ["/select,", "D:\\work\\my repo\\a.txt"],
  });
  // xdg-open has no selection: the folder that holds it.
  assert.deepEqual(fileManagerRevealCommand("linux", "/home/dev/repo/src/a.ts"), {
    command: "xdg-open",
    args: ["/home/dev/repo/src"],
  });
  assert.equal(fileManagerRevealCommand("aix", "/tmp/a"), null);
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

test("hands a WSL path to Windows' Explorer in its Windows form", () => {
  const wsl = { WSL_DISTRO_NAME: "Ubuntu" };
  assert.equal(fileManagerPlatform("linux", wsl), "win32");
  assert.equal(fileManagerPlatform("linux", {}), "linux");
  assert.equal(fileManagerPlatform("darwin", wsl), "darwin");
  assert.equal(windowsPathForWsl("/mnt/c/dev/repo/", "Ubuntu"), "C:\\dev\\repo");
  assert.equal(windowsPathForWsl("/mnt/d", "Ubuntu"), "D:\\");
  assert.equal(windowsPathForWsl("/home/me/repo", "Ubuntu"), "\\\\wsl$\\Ubuntu\\home\\me\\repo");
  assert.equal(windowsPathForWsl("/", "Ubuntu"), "\\\\wsl$\\Ubuntu\\");
  assert.equal(windowsPathForWsl("/mnt/cdrom", "Ubuntu"), "\\\\wsl$\\Ubuntu\\mnt\\cdrom");
});
