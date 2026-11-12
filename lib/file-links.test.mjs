import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-links.ts");
}

test("opens local files for plain, Command, and Ctrl left clicks", async () => {
  const { shouldOpenLocalFileInApp } = await loadSubject();
  const click = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  assert.equal(shouldOpenLocalFileInApp(click), true);
  assert.equal(shouldOpenLocalFileInApp({ ...click, metaKey: true }), true);
  assert.equal(shouldOpenLocalFileInApp({ ...click, ctrlKey: true }), true);
});

test("leaves secondary modified and non-left clicks to the browser", async () => {
  const { shouldOpenLocalFileInApp } = await loadSubject();
  const click = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  assert.equal(shouldOpenLocalFileInApp({ ...click, shiftKey: true }), false);
  assert.equal(shouldOpenLocalFileInApp({ ...click, altKey: true }), false);
  assert.equal(shouldOpenLocalFileInApp({ ...click, button: 1 }), false);
  assert.equal(shouldOpenLocalFileInApp({ ...click, defaultPrevented: true }), false);
});

test("resolves absolute markdown file links and strips line suffixes", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/project/components/MarkdownBody.tsx:36",
      "/home/me/project",
    ),
    "/home/me/project/components/MarkdownBody.tsx",
  );
});

test("resolves absolute file links outside cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref(
      "/home/me/.codex/config.toml:12",
      "/home/me/project",
    ),
    "/home/me/.codex/config.toml",
  );
});

test("resolves relative markdown file links against cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("components/AppShell.tsx#L42", "/home/me/project"),
    "/home/me/project/components/AppShell.tsx",
  );
});

test("does not let relative links escape cwd", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../outside.md", "/home/me/project"),
    null,
  );
});

test("resolves preview links from the file directory within the project root", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("../file.js", "/home/me/project/docs/nested", "/home/me/project"),
    "/home/me/project/docs/file.js",
  );
  assert.equal(
    resolveLocalFileHref("../../../outside.js", "/home/me/project/docs/nested", "/home/me/project"),
    null,
  );
});

test("does not treat app or external URLs as file links", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(resolveLocalFileHref("/api/files/home/me/project/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("https://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("ftp://example.com/a.ts", "/home/me/project"), null);
  assert.equal(resolveLocalFileHref("//example.com/a.ts", "/home/me/project"), null);
});

test("decodes file URL paths once after parsing URL delimiters", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  for (const [href, expected] of [
    ["file:///home/me/project/C%23/report.html", "/home/me/project/C#/report.html"],
    ["file:///home/me/project/report%3F.html", "/home/me/project/report?.html"],
    ["file:///home/me/project/report%2520.html", "/home/me/project/report%20.html"],
    ["file:///home/me/project/report%20one.html?raw=1#L10", "/home/me/project/report one.html"],
    ["file:///C:/Users/me/C%23/report%2520.html", "C:/Users/me/C#/report%20.html"],
    ["file://server/share/C%23/report%2520.html", "//server/share/C#/report%20.html"],
  ]) {
    assert.equal(resolveLocalFileHref(href, "/home/me/project"), expected, href);
  }
});

test("resolves Windows file URLs without a synthetic leading slash", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file:///C:/Users/me/project/file.txt:10", "C:/Users/me/project"),
    "C:/Users/me/project/file.txt",
  );
});

test("resolves UNC file URLs and backslash UNC paths", async () => {
  const { resolveLocalFileHref } = await loadSubject();

  assert.equal(
    resolveLocalFileHref("file://server/share/project/file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
  assert.equal(
    resolveLocalFileHref("\\\\server\\share\\project\\file.txt", "/home/me/project"),
    "//server/share/project/file.txt",
  );
});

test("reads the PDF page fragment from markdown links", async () => {
  const { parsePdfPageFragment } = await loadSubject();

  assert.equal(parsePdfPageFragment("/api/files/report.pdf?type=read#page=12"), 12);
  assert.equal(parsePdfPageFragment("file:///home/me/report.pdf#page=7"), 7);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#PAGE=3"), 3);
});

test("ignores fragments that are not a PDF page selector", async () => {
  const { parsePdfPageFragment } = await loadSubject();

  assert.equal(parsePdfPageFragment(undefined), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#L42"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=0"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=-1"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=abc"), null);
  assert.equal(parsePdfPageFragment("/home/me/report.pdf#page=12&zoom=100"), null);
});

// A Windows session's bash tool prints a drive the way its shell spells it
// (`/d/work`), so a path quoted from a tool call — a written-file chip, a path in
// a reply — must land on `D:/work`, not on a `d` folder beside the cwd's drive.
// Off Windows `/d/work` is an ordinary folder and must stay one: the form of the
// base directory decides, never `process.platform`, because this module also
// runs in the browser.
const WINDOWS_CWD = String.raw`D:\work\pi-work`;

test("resolves shell-style drive paths below a Windows cwd", async () => {
  const { resolveLocalFilePath, resolveLocalFileHref } = await loadSubject();

  for (const shellPath of [
    "/d/work/pi-work/src/a.ts",
    "/mnt/d/work/pi-work/src/a.ts",
    "/cygdrive/d/work/pi-work/src/a.ts",
  ]) {
    assert.equal(resolveLocalFilePath(shellPath, WINDOWS_CWD), "D:/work/pi-work/src/a.ts", shellPath);
    assert.equal(resolveLocalFileHref(shellPath, WINDOWS_CWD), "D:/work/pi-work/src/a.ts", shellPath);
  }

  // Another drive, and the drive root in the form the native spelling resolves to.
  assert.equal(resolveLocalFilePath("/c/Users/me/a.ts", WINDOWS_CWD), "C:/Users/me/a.ts");
  assert.equal(resolveLocalFilePath("/d", WINDOWS_CWD), resolveLocalFilePath("D:/", WINDOWS_CWD));

  // Relative and UNC paths keep their meaning.
  assert.equal(resolveLocalFilePath("src/a.ts", WINDOWS_CWD), "D:/work/pi-work/src/a.ts");
  assert.equal(resolveLocalFilePath("//server/share/a.ts", WINDOWS_CWD), "//server/share/a.ts");
});

test("leaves a single-letter root folder alone below a POSIX cwd", async () => {
  const { resolveLocalFilePath, resolveLocalFileHref, normalizeShellDrivePath } = await loadSubject();

  assert.equal(resolveLocalFileHref("/d/work/a.ts", "/home/me/project"), "/d/work/a.ts");
  assert.equal(resolveLocalFilePath("/d/work/a.ts", "/home/me/project"), "/d/work/a.ts");
  assert.equal(resolveLocalFileHref("/home/me/a.ts", "/home/me/project"), "/home/me/a.ts");

  // The helper itself has no platform opinion; the callers decide.
  assert.equal(normalizeShellDrivePath("/d/work/a.ts"), "D:/work/a.ts");
  assert.equal(normalizeShellDrivePath("//server/share/a.ts"), "//server/share/a.ts");
  assert.equal(normalizeShellDrivePath("./d/a.ts"), "./d/a.ts");
});
