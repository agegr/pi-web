import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  classifySessionFile,
  collectSessionWrittenFiles,
  readSessionFileFilter,
  sessionFileLocation,
  sessionWrittenFileKey,
  writeSessionFileFilter,
} = await jiti.import("./session-written-files.ts");

function toolCall(toolCallId, toolName, input) {
  return { type: "toolCall", toolCallId, toolName, input };
}

function assistant(content, timestamp) {
  return { role: "assistant", content, model: "test", provider: "test", timestamp };
}

function okResult(toolCallId, timestamp) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }], timestamp };
}

test("counts only successful writes and keeps one row per path", () => {
  const messages = [
    assistant([
      { type: "text", text: "see /tmp/mentioned.md" },
      toolCall("1", "write", { file_path: "/repo/docs/a.md" }),
      toolCall("2", "write", { file_path: "/repo/docs/missing.md" }),
    ], 1_000),
    assistant([toolCall("3", "edit", { path: "/repo/docs/a.md" })], 5_000),
  ];
  const results = new Map([
    ["1", okResult("1", 1_100)],
    ["2", { ...okResult("2", 1_200), isError: true }],
    ["3", okResult("3", 5_100)],
  ]);

  const files = collectSessionWrittenFiles(messages, results, "/repo");
  assert.deepEqual(files.map((file) => file.filePath), ["/repo/docs/a.md"]);
  assert.equal(files[0].writeCount, 2);
  assert.equal(files[0].sessionWrittenAtMs, 5_100);
  assert.equal(files[0].kind, "markdown");
});

test("does not count the same streaming tool call twice", () => {
  const call = toolCall("1", "write", { file_path: "/repo/page.html" });
  const streaming = assistant([call], 2_000);
  const messages = [streaming];
  const results = new Map([["1", okResult("1", 2_100)]]);
  const once = collectSessionWrittenFiles(messages, results, "/repo", streaming);
  assert.equal(once[0].writeCount, 1);
  assert.equal(once[0].kind, "html");
  assert.equal(
    sessionWrittenFileKey(messages, results, "/repo", { ...streaming, content: [...streaming.content, { type: "text", text: "more" }] }),
    sessionWrittenFileKey(messages, results, "/repo", streaming),
  );
});

test("remembers a known file filter and drops anything else", () => {
  const stored = new Map();
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  writeSessionFileFilter(storage, "html");
  assert.equal(readSessionFileFilter(storage), "html");
  stored.set("pi-session-files-filter", "nope");
  assert.equal(readSessionFileFilter(storage), "all");
  assert.equal(readSessionFileFilter({ getItem: () => { throw new Error("blocked"); } }), "all");
});

test("file types and session-relative locations remain distinct", () => {
  assert.equal(classifySessionFile("/repo/App.tsx"), "code");
  assert.equal(classifySessionFile("/repo/index.html"), "html");
  assert.equal(classifySessionFile("/repo/data.json"), "data");
  assert.equal(classifySessionFile("/repo/shot.png"), "image");
  assert.equal(classifySessionFile("/repo/notes.txt"), "other");
  assert.deepEqual(sessionFileLocation("/repo/docs/a.md", "/repo"), { name: "a.md", directory: "docs" });
});

test("apply_patch drops deletes and sorts the newest write first", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: src/a.ts",
    "+hello",
    "*** Delete File: gone.ts",
    "*** End Patch",
  ].join("\n");
  const messages = [
    assistant([toolCall("1", "write", { path: "/repo/README.md" })], 1_000),
    assistant([toolCall("2", "apply_patch", { input: patch })], 3_000),
  ];
  const results = new Map([
    ["1", okResult("1", 1_100)],
    ["2", {
      role: "toolResult",
      toolCallId: "2",
      timestamp: 3_100,
      content: [{ type: "text", text: "ok" }],
      details: { result: { appliedFiles: ["src/a.ts", "gone.ts"], failures: [] } },
    }],
  ]);
  const files = collectSessionWrittenFiles(messages, results, "/repo");
  assert.deepEqual(files.map((file) => [file.filePath, file.kind]), [
    ["/repo/src/a.ts", "code"],
    ["/repo/README.md", "markdown"],
  ]);
});
