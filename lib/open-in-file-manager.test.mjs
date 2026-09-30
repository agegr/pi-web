import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  fileManagerCommand,
  isFileManagerSupported,
  isLoopbackHost,
  launchFileManager,
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
