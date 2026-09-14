import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { extractTurnWrittenFiles } = await jiti.import("./turn-written-files.ts");
const { TEXT_PREVIEW_MAX_BYTES } = await jiti.import("./file-types.ts");

function toolCall(toolCallId, toolName, input) {
  return { type: "toolCall", toolCallId, toolName, input };
}

function okResult(toolCallId, details) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }], details };
}

function errorResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "boom" }], isError: true };
}

function results(...entries) {
  return new Map(entries.map((r) => [r.toolCallId, r]));
}

function paths(content, toolResults, cwd) {
  return extractTurnWrittenFiles(content, toolResults, cwd).map((f) => f.filePath);
}

test("extracts a file from a successful write tool call", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/out/report.html"]);
});

test("extracts a file from a successful edit tool call using input.path", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/src/a.ts"]);
});

test("accepts namespaced write/edit tool names from MCP servers", () => {
  const content = [
    toolCall("1", "write_file", { file_path: "/abs/a.txt" }),
    toolCall("2", "fs.edit", { file_path: "/abs/b.txt" }),
    toolCall("3", "str_replace_editor", { file_path: "/abs/c.txt" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2"), okResult("3"))),
    ["/abs/a.txt", "/abs/b.txt", "/abs/c.txt"],
  );
});

test("skips a tool call whose result errored", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(errorResult("1"))), []);
});

test("skips a tool call whose result has not arrived (streaming)", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results()), []);
  assert.deepEqual(paths(content, undefined), []);
});

test("deduplicates the same file written then edited", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/report.html" }),
    toolCall("2", "edit", { path: "/abs/out/report.html" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), ["/abs/out/report.html"]);
});

test("resolves a relative path against cwd", () => {
  const content = [toolCall("1", "write", { file_path: "out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1")), "/abs"), ["/abs/out/report.html"]);
});

test("resolves extensionless and dot-prefixed filenames against cwd", () => {
  const content = [
    toolCall("1", "write", { path: "LICENSE" }),
    toolCall("2", "write", { path: ".env" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2")), "/repo"),
    ["/repo/LICENSE", "/repo/.env"],
  );
});

test("preserves path characters that have special meaning in hrefs", () => {
  const content = [
    toolCall("1", "write", { path: "release#1.md" }),
    toolCall("2", "write", { path: "query?.json" }),
    toolCall("3", "write", { path: "report.md:42" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2"), okResult("3")), "/repo"),
    ["/repo/release#1.md", "/repo/query?.json", "/repo/report.md:42"],
  );
});

test("normalizes Windows-relative tool paths against a Windows cwd", () => {
  const content = [toolCall("1", "write", { path: "src\\report.html" })];
  assert.deepEqual(
    paths(content, results(okResult("1")), "C:\\repo"),
    ["C:/repo/src/report.html"],
  );
});

test("skips non-writing tools like read and bash", () => {
  const content = [
    toolCall("1", "read", { file_path: "/abs/a.ts" }),
    toolCall("2", "bash", { command: "echo hi > /abs/a.txt" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), []);
});

test("ignores paths that only appear in the reply text", () => {
  // A path the assistant merely writes in prose is not evidence of a write.
  const content = [
    { type: "text", text: "I saved the report to /abs/out/report.html for you." },
  ];
  assert.deepEqual(paths(content, results()), []);
});

test("lists only the file actually written, not others named in the text", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/real.html" }),
    { type: "text", text: "See also /abs/out/imagined.html and /etc/passwd" },
  ];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/out/real.html"]);
});

test("skips a write call missing both file_path and path", () => {
  const content = [toolCall("1", "write", { content: "hi" })];
  assert.deepEqual(paths(content, results(okResult("1"))), []);
});

test("returns an empty array for an empty or text-only turn", () => {
  assert.deepEqual(paths([], results()), []);
  assert.deepEqual(paths([{ type: "text", text: "hi" }], results()), []);
});

const EDIT_PATCH = [
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

test("attaches an edit tool result patch to the written file", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1", { patch: EDIT_PATCH })));
  assert.equal(files[0]?.filePath, "/abs/src/a.ts");
  assert.equal(files[0]?.patch, EDIT_PATCH);
});

test("prefers details.patch over details.diff for an edit", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1", { patch: EDIT_PATCH, diff: "-ignored\n+nope\n" })));
  assert.equal(files[0]?.patch, EDIT_PATCH);
});

test("falls back to details.diff when patch is absent", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1", { diff: EDIT_PATCH })));
  assert.equal(files[0]?.patch, EDIT_PATCH);
});

test("synthesizes a new-file patch from a successful write's content", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html", content: "hello\n" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1")));
  assert.equal(files[0]?.filePath, "/abs/out/report.html");
  assert.match(files[0]?.patch ?? "", /new file mode 100644/);
  assert.match(files[0]?.patch ?? "", /\+\+\+ b\/report\.html/);
  assert.match(files[0]?.patch ?? "", /\+hello/);
});

test("omits patch for a write without content", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1")));
  assert.equal(files[0]?.filePath, "/abs/out/report.html");
  assert.equal(files[0]?.patch, undefined);
});

test("concatenates patches when the same file is written then edited", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/report.html", content: "hello\n" }),
    toolCall("2", "edit", { path: "/abs/out/report.html" }),
  ];
  const files = extractTurnWrittenFiles(content, results(
    okResult("1"),
    okResult("2", { patch: EDIT_PATCH }),
  ));
  assert.equal(files.length, 1);
  assert.match(files[0]?.patch ?? "", /\+hello/);
  assert.match(files[0]?.patch ?? "", /\+new/);
});

test("omits a synthesized write patch when content exceeds the preview limit", () => {
  const content = [toolCall("1", "write", {
    file_path: "/abs/out/huge.txt",
    content: "x".repeat(TEXT_PREVIEW_MAX_BYTES + 1),
  })];
  const files = extractTurnWrittenFiles(content, results(okResult("1")));
  assert.equal(files[0]?.filePath, "/abs/out/huge.txt");
  assert.equal(files[0]?.patch, undefined);
});

test("counts added and deleted lines from an edit patch", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1", { patch: EDIT_PATCH })));
  assert.equal(files[0]?.additions, 1);
  assert.equal(files[0]?.deletions, 1);
});

test("counts added lines from a synthesized write patch", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html", content: "hello\nworld\n" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1")));
  assert.equal(files[0]?.additions, 2);
  assert.equal(files[0]?.deletions, 0);
});

test("sums line counts when the same file is written then edited", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/report.html", content: "hello\n" }),
    toolCall("2", "edit", { path: "/abs/out/report.html" }),
  ];
  const files = extractTurnWrittenFiles(content, results(
    okResult("1"),
    okResult("2", { patch: EDIT_PATCH }),
  ));
  assert.equal(files[0]?.additions, 2);
  assert.equal(files[0]?.deletions, 1);
});

test("uses zero line counts when no patch is available", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1")));
  assert.equal(files[0]?.additions, 0);
  assert.equal(files[0]?.deletions, 0);
});

test("counts in-hunk lines that look like ---/+++ file headers", () => {
  const patch = [
    "--- a/notes.md",
    "+++ b/notes.md",
    "@@ -1,2 +1,2 @@",
    "--- old bullet",
    "+++ new bullet",
    "",
  ].join("\n");
  const content = [toolCall("1", "edit", { path: "/abs/notes.md" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1", { patch })));
  assert.equal(files[0]?.additions, 1);
  assert.equal(files[0]?.deletions, 1);
});

test("does not count absolute-path ---/+++ headers as line stats", () => {
  // pi's edit tool emits `--- /abs/path` headers, not `--- a/file`.
  const patch = [
    "--- /Users/kitten9455/iMile/smip/README.md",
    "+++ /Users/kitten9455/iMile/smip/README.md",
    "@@ -28,4 +28,8 @@",
    " bun run dev:all",
    " ```",
    " ",
    " context line",
    "+",
    "+```ts",
    '+console.log("test");',
    "+```",
    "",
  ].join("\n");
  const content = [toolCall("1", "edit", { path: "/Users/kitten9455/iMile/smip/README.md" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1", { patch })));
  assert.equal(files[0]?.additions, 4);
  assert.equal(files[0]?.deletions, 0);
});

test("counts replace hunks from absolute-path patches as visible +/− lines", () => {
  const patch = [
    "--- /Users/kitten9455/iMile/smip/README.md",
    "+++ /Users/kitten9455/iMile/smip/README.md",
    "@@ -30,6 +30,7 @@",
    " ",
    " context line",
    " ",
    " ```ts",
    '-console.log("test");',
    '+console.log("line a");',
    '+console.log("line b");',
    " ```",
    "",
  ].join("\n");
  const content = [toolCall("1", "edit", { path: "/Users/kitten9455/iMile/smip/README.md" })];
  const files = extractTurnWrittenFiles(content, results(okResult("1", { patch })));
  assert.equal(files[0]?.additions, 2);
  assert.equal(files[0]?.deletions, 1);
});
