import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { extractTurnWrittenFiles } = await jiti.import("./turn-written-files.ts");

function toolCall(toolCallId, toolName, input) {
  return { type: "toolCall", toolCallId, toolName, input };
}

function okResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }] };
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
