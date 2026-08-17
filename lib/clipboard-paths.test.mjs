import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  fileUriToPath,
  extractPathsFromClipboardData,
  formatPathsForInput,
} = await jiti.import("./clipboard-paths.ts");

test("fileUriToPath parses Unix file URIs", () => {
  assert.equal(fileUriToPath("file:///home/user/project/file.txt"), "/home/user/project/file.txt");
  assert.equal(fileUriToPath("file:///Users/john/Documents"), "/Users/john/Documents");
  assert.equal(fileUriToPath("file://localhost/Users/john/Documents"), "/Users/john/Documents");
});

test("fileUriToPath parses Windows file URIs", () => {
  assert.equal(fileUriToPath("file:///C:/Users/user/project/file.txt"), "C:/Users/user/project/file.txt");
  assert.equal(fileUriToPath("file:///d:/repo/subfolder"), "d:/repo/subfolder");
  assert.equal(fileUriToPath("file://server/share/file.txt"), "//server/share/file.txt");
});

test("fileUriToPath decodes percent-encoded characters and spaces", () => {
  assert.equal(
    fileUriToPath("file:///home/user/my%20folder/%E6%96%87%E4%BB%B6.txt"),
    "/home/user/my folder/文件.txt"
  );
  assert.equal(
    fileUriToPath("file:///C:/Program%20Files/App/test%20file.json"),
    "C:/Program Files/App/test file.json"
  );
});

test("fileUriToPath returns non-file URIs as trimmed strings", () => {
  assert.equal(fileUriToPath("  /home/user/file.txt  "), "/home/user/file.txt");
  assert.equal(fileUriToPath("C:\\Users\\user\\file.txt"), "C:\\Users\\user\\file.txt");
});

test("extractPathsFromClipboardData extracts paths from File.path (Electron / Desktop)", () => {
  const fakeClipboard = {
    files: [
      { path: "/home/user/project/a.txt", name: "a.txt" },
      { path: "/home/user/project/b.txt", name: "b.txt" },
    ],
    items: [],
    getData: () => "",
  };

  const paths = extractPathsFromClipboardData(fakeClipboard);
  assert.deepEqual(paths, ["/home/user/project/a.txt", "/home/user/project/b.txt"]);
});

test("extractPathsFromClipboardData extracts paths from text/uri-list", () => {
  const uriList = [
    "# Comment line",
    "file:///home/user/code/index.ts",
    "file:///home/user/code/package.json",
  ].join("\r\n");

  const fakeClipboard = {
    files: [],
    items: [],
    getData: (type) => (type === "text/uri-list" ? uriList : ""),
  };

  const paths = extractPathsFromClipboardData(fakeClipboard);
  assert.deepEqual(paths, ["/home/user/code/index.ts", "/home/user/code/package.json"]);
});

test("extractPathsFromClipboardData extracts paths from Linux Nautilus/GNOME clipboard", () => {
  const nautilusData = "copy\nfile:///home/user/photos/image.png\nfile:///home/user/photos/doc.pdf";

  const fakeClipboard = {
    files: [],
    items: [],
    getData: (type) => (type === "x-special/nautilus-clipboard" ? nautilusData : ""),
  };

  const paths = extractPathsFromClipboardData(fakeClipboard);
  assert.deepEqual(paths, ["/home/user/photos/image.png", "/home/user/photos/doc.pdf"]);
});

test("extractPathsFromClipboardData extracts paths from macOS public.file-url", () => {
  const fakeClipboard = {
    files: [],
    items: [],
    getData: (type) => (type === "public.file-url" ? "file:///Users/name/Desktop/test.ts" : ""),
  };

  const paths = extractPathsFromClipboardData(fakeClipboard);
  assert.deepEqual(paths, ["/Users/name/Desktop/test.ts"]);
});

test("extractPathsFromClipboardData extracts paths from text/plain with file:// URIs", () => {
  const fakeClipboard = {
    files: [],
    items: [],
    getData: (type) => (type === "text/plain" ? "file:///home/user/test.py" : ""),
  };

  const paths = extractPathsFromClipboardData(fakeClipboard);
  assert.deepEqual(paths, ["/home/user/test.py"]);
});

test("extractPathsFromClipboardData handles null or empty clipboard data", () => {
  assert.deepEqual(extractPathsFromClipboardData(null), []);
  assert.deepEqual(
    extractPathsFromClipboardData({
      files: [],
      items: [],
      getData: () => "",
    }),
    []
  );
});

test("extractPathsFromClipboardData supports fallbackToFileName", () => {
  const fakeClipboard = {
    files: [{ name: "myfile.zip" }],
    items: [],
    getData: () => "",
  };

  assert.deepEqual(extractPathsFromClipboardData(fakeClipboard, { fallbackToFileName: true }), ["myfile.zip"]);
  assert.deepEqual(extractPathsFromClipboardData(fakeClipboard), []);
});

test("formatPathsForInput formats paths with quotes when containing spaces", () => {
  assert.equal(formatPathsForInput([]), "");
  assert.equal(formatPathsForInput(["/home/user/file.txt"]), "/home/user/file.txt");
  assert.equal(
    formatPathsForInput(["/home/user/my file.txt", "/home/user/other.txt"]),
    '"/home/user/my file.txt" /home/user/other.txt'
  );
  assert.equal(
    formatPathsForInput(['"already quoted"', "simple"]),
    '"already quoted" simple'
  );
});
