import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { isLoopbackHost, openFolderCommand, revealFileCommand } = await jiti.import("./open-folder.ts");

test("windows opens folders with explorer.exe", () => {
  assert.deepEqual(
    openFolderCommand("C:\\Users\\Test User\\my project", "win32"),
    { command: "explorer.exe", args: ["C:\\Users\\Test User\\my project"] },
  );
});

test("windows passes drive roots through unchanged", () => {
  assert.deepEqual(openFolderCommand("F:\\", "win32"), { command: "explorer.exe", args: ["F:\\"] });
});

test("macOS opens folders with open", () => {
  assert.deepEqual(
    openFolderCommand("/Users/test/my project", "darwin"),
    { command: "open", args: ["/Users/test/my project"] },
  );
});

test("linux opens folders with xdg-open", () => {
  assert.deepEqual(
    openFolderCommand("/home/test/proj", "linux"),
    { command: "xdg-open", args: ["/home/test/proj"] },
  );
});

test("unknown platforms fall back to xdg-open", () => {
  assert.deepEqual(openFolderCommand("/any", "freebsd"), { command: "xdg-open", args: ["/any"] });
});

test("windows reveals files by selecting them in explorer.exe", () => {
  assert.deepEqual(
    revealFileCommand("C:\\Users\\Test User\\my project\\out.txt", "win32"),
    { command: "explorer.exe", args: ["/select,C:\\Users\\Test User\\my project\\out.txt"] },
  );
});

test("macOS reveals files with open -R", () => {
  assert.deepEqual(
    revealFileCommand("/Users/test/my project/out.txt", "darwin"),
    { command: "open", args: ["-R", "/Users/test/my project/out.txt"] },
  );
});

test("linux falls back to opening the containing folder", () => {
  assert.deepEqual(
    revealFileCommand("/home/test/proj/out.txt", "linux"),
    { command: "xdg-open", args: ["/home/test/proj"] },
  );
});

test("unknown platforms reveal by opening the containing folder", () => {
  assert.deepEqual(revealFileCommand("/any/out.txt", "freebsd"), { command: "xdg-open", args: ["/any"] });
});

test("treats loopback hosts as local", () => {
  assert.equal(isLoopbackHost("127.0.0.1:30141"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("127.1.2.3:8080"), true);
  assert.equal(isLoopbackHost("localhost:30141"), true);
  assert.equal(isLoopbackHost("LOCALHOST"), true);
  assert.equal(isLoopbackHost("[::1]:30141"), true);
  assert.equal(isLoopbackHost("::1"), true);
});

test("treats anything else as remote", () => {
  assert.equal(isLoopbackHost("192.168.1.5:30141"), false);
  assert.equal(isLoopbackHost("10.0.0.5"), false);
  assert.equal(isLoopbackHost("pi.example.com"), false);
  assert.equal(isLoopbackHost("127.0.0.1.evil.com"), false);
  assert.equal(isLoopbackHost("localhost.evil.com"), false);
  assert.equal(isLoopbackHost("[::1"), false);
  assert.equal(isLoopbackHost(""), false);
  assert.equal(isLoopbackHost(null), false);
  assert.equal(isLoopbackHost(undefined), false);
});
